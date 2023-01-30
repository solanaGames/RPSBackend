#!/usr/bin/env ts-node
import { program } from 'commander';
import { exec } from 'child_process';
import * as fs from 'fs';
import { JSONPath } from 'jsonpath-plus';
import { v4 as uuidv4 } from 'uuid';
import { Table } from 'console-table-printer';

const TERMINAL_COLORS = [
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'crimson',
  'white_bold',
  'red',
].sort(() => Math.random() - 0.5);
program.version('0.0.2');

program
  .command('deploy <serviceOrNamespace>')
  .description(
    'Deploys a certain service or namespace to the specified version',
  )
  .action(async (serviceOrNamespace: string) => {
    await deploy(serviceOrNamespace);
  });

program
  .command('deploy-options')
  .description('Print out deployment options')
  .action(async () => {
    console.log(Object.keys(NAMESPACE_TO_DEPLOY_CONFIG));
  });


program
  .command('bump <serviceOrNamespace>')
  .description('Runs cmd on all nodes in redis cluster')
  .action(async (serviceOrNamespace: string) => {
    await bumpHash(serviceOrNamespace);
  });

program
  .command('list-services')
  .description('List all services running in the solbet ecs cluster')
  .action(async () => {
    await listServices();
  });

program
  .command('list-tasks')
  .description('List all the tasks running in the solbet ecs cluster')
  .action(async () => {
    await listTasks();
  });

program
  .command('list-instances')
  .description('List all the ec2 instances running for this cluster')
  .action(async () => {
    await listInstances();
  });

program
  .command('service-info <service_name>')
  .description('Show details about a specific service')
  .action(async (serviceName: string) => {
    await showService(serviceName);
  });


// ECS Stuff starts here
const ECS_CLUSTER_NAME = 'solbet-cluster';
const NAMESPACE_TO_DEPLOY_CONFIG: { [key: string]: string } = {
  'daemons': './ecs/groups/daemons.json',
  'solbet-api-server': './ecs/groups/solbet-api-server.json',
};

// Bumps the image for every deployment task in the deployment file
// to the laste image.
async function bumpDeploymentFileImages(deploymentFile: string) {
  const deploymentData = require(deploymentFile);
  for (const deployment of deploymentData['deployments']) {
    const repoName = deployment.imageRepository;
    const latestImageHash = await awsCli(
      `ecr describe-images --repository-name ${repoName} --query 'sort_by(imageDetails,& imagePushedAt)[-1].imageTags[0]'`,
    );
    const oldImage =
      deployment['taskReplacements']['$.containerDefinitions[0]']['image'];
    const newImage = oldImage.split(':')[0] + ':' + latestImageHash;
    console.log(
      `Updating ${deployment['id']} from \n\t${oldImage} \n\tto\n\t${newImage}`,
    );
    deployment['taskReplacements']['$.containerDefinitions[0]']['image'] =
      newImage;
  }
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentData, null, 2), {
    encoding: 'utf8',
    flag: 'w',
  });
}

// Syncs a deployment file with the ECS cluster
// Does the following things:
// 1. Verify that the deployment file is sane
// 2. For each deploymet config in the file
//    3. Apply the templating
//    4. Write the new value to a tmp file
//    5. Create a new task revision
//    6. Create a new service if it exists, otherwise update the existing one
// 7. Remove all of the existing services that don't appear in this namespace
// Not used for api-server* roles, but used for everything else.
async function syncDeployment(deploymentFile: string) {
  const deployConfig = require(deploymentFile);
  const allExistingServices = await getAllServiceNames();
  const updatedServices: string[] = [];

  verifyDeploymentFile(deployConfig);
  for (const config of deployConfig['deployments']) {
    const taskTemplateFile = require(config['taskTemplate']);
    const taskDefinition = applyReplacementsToTemplate(
      taskTemplateFile,
      config['taskReplacements'],
    );

    // Autogenerate the family as the <namespace>_<id>
    // This is the name of both the task and the service
    let serviceAndTaskName = deployConfig['namespace'] + '_' + config['id'];
    (taskDefinition as any)['family'] = serviceAndTaskName;
    updatedServices.push(serviceAndTaskName);

    // Write the input data to a tmp file
    const tmpFilename = `/tmp/${uuidv4()}.json`;
    fs.writeFileSync(tmpFilename, JSON.stringify(taskDefinition), {
      encoding: 'utf8',
      flag: 'w',
    });

    const resultJSON = await awsCli(
      `ecs register-task-definition --cli-input-json file://${tmpFilename}`,
    );
    console.log(
      `Registered task: ${resultJSON['taskDefinition']['family']}:${resultJSON['taskDefinition']['revision']}`,
    );
    const taskNameAndRevision = `${serviceAndTaskName}:${resultJSON['taskDefinition']['revision']}`;
    const shouldCreateNewService =
      !allExistingServices.includes(serviceAndTaskName) &&
      !serviceAndTaskName.includes('solbet-api-server');

    // Create a new service, or update an existing one
    if (!shouldCreateNewService) {
      console.log('Updating existing service to new task');
      serviceAndTaskName =
        {
          'api_solbet-api-server': 'solbet-api-server',
        }[serviceAndTaskName] || serviceAndTaskName;
      await updateServiceTask(serviceAndTaskName, taskNameAndRevision);
    } else {
      // Create a new service
      console.log(`Creating a new service: ${serviceAndTaskName}`);
      const tmpServiceFilename = `/tmp/${uuidv4()}.json`;
      const template = require(config['serviceTemplate']);
      const serviceDefinition = applyReplacementsToTemplate(
        template,
        config['serviceReplacements'],
      );
      (serviceDefinition as any)['serviceName'] = serviceAndTaskName;
      (serviceDefinition as any)['taskDefinition'] = taskNameAndRevision;
      fs.writeFileSync(tmpServiceFilename, JSON.stringify(serviceDefinition), {
        encoding: 'utf8',
        flag: 'w',
      });
      await createService(tmpServiceFilename);
    }
    await printDeployStartedMessage(
      taskNameAndRevision,
      resultJSON['taskDefinition']['containerDefinitions'][0]['image'].split(
        ':',
      )[1],
    );
  }

  const currentServices = await getAllServiceNames();
  const servicesToRemove: string[] = [];
  for (const service of currentServices) {
    // IMPORTANT! Only delete services within your own namespace
    if (
      !updatedServices.includes(service) &&
      service.startsWith(deployConfig['namespace'] + '_')
    ) {
      servicesToRemove.push(service);
    }
  }
  if (servicesToRemove.length === 0) {
    return;
  }
  console.log(
    'The following services will be removed:',
    servicesToRemove.join(' '),
  );
  for (const service of servicesToRemove) {
    await awsCli(
      `ecs delete-service --cluster ${ECS_CLUSTER_NAME} --service ${service} --force`,
    );
  }
  console.log('Done');
}

function applyReplacementsToTemplate(template: {}, replacements: {}) {
  Object.entries(replacements).forEach(([path, valuesToSet]) => {
    JSONPath({
      json: template,
      path,
      wrap: false,
      callback(obj) {
        Object.entries(valuesToSet as any).forEach(([key, val]) => {
          obj[key] = val;
        });
      },
    });
  });
  return template;
}

async function updateServiceTask(serviceName: string, taskName: string) {
  return await awsCli(
    `ecs update-service --service ${serviceName} --cluster ${ECS_CLUSTER_NAME} --task-definition ${taskName} --force-new-deployment`,
  );
}

async function deploy(serviceOrNamespace: string) {
  syncDeployment(NAMESPACE_TO_DEPLOY_CONFIG[serviceOrNamespace]);
}

async function bumpHash(serviceOrNamespace: string) {
  await bumpDeploymentFileImages(
    NAMESPACE_TO_DEPLOY_CONFIG[serviceOrNamespace],
  );
}

async function awsCli(command: string) {
  let profile = process.env.AWS_PROFILE;
  if (profile === undefined) {
    throw `Must set environment for AWS_PROFILE`;
  }
  return JSON.parse(
    await shellCommand(`AWS_DEFAULT_OUTPUT=json aws ${command} --profile ${profile}`),
  );
}

async function shellCommand(command: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    exec(`${command}`, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      if (stderr) {
        resolve(stderr);
        return;
      }
      resolve(stdout);
    });
  });
}

async function getCaller() {
  const result = await awsCli('sts get-caller-identity');
  return result['Arn'].split('/')[1];
}

async function printDeployStartedMessage(
  newVersion: string,
  commitHash: string,
) {
  const user = await getCaller();
  console.log(
    `\`${user}\` started a service deployment for revision ${newVersion} [${commitHash.substring(
      0,
      6,
    )}](https://github.com/solbet1/RPSBackend/commit/${commitHash}/)`,
  );
}

async function listServices() {
  const namespaceToColor: { [key: string]: string } = {};
  let colorIndex = 0;

  const result = await awsCli(`ecs list-services --cluster ${ECS_CLUSTER_NAME}`);
  const serviceARNs = result['serviceArns'];
  const serviceDetails = await describeServices(serviceARNs);
  const sortedServices = serviceDetails.sort((a: any, b: any) =>
    a['serviceName'].localeCompare(b['serviceName']),
  );
  const table = new Table({ title: 'Services' });
  for (const details of sortedServices) {
    const namespace = details['serviceName'].split('_')[0];
    if (namespaceToColor[namespace] === undefined) {
      namespaceToColor[namespace] =
        TERMINAL_COLORS[colorIndex % TERMINAL_COLORS.length];
      colorIndex += 1;
    }
    table.addRow(
      {
        namespace: namespace,
        name: details['serviceName'],
        status: details['status'],
        count: details['runningCount'],
        desired: details['desiredCount'],
        delta: details['desiredCount'] - details['runningCount'],
        pending: details['pendingCount'],
      },
      {
        color: namespaceToColor[namespace],
      },
    );
  }
  table.printTable();
}

async function listTasks() {
  const taskARNs = (
    await awsCli(`ecs list-tasks --cluster ${ECS_CLUSTER_NAME}`)
  )['taskArns'];
  const taskData = await awsCli(
    `ecs describe-tasks --cluster ${ECS_CLUSTER_NAME} --tasks ${taskARNs.join(
      ' ',
    )}`,
  );
  const containerInstanceARNs: string[] = taskData['tasks'].map(
    (x: any) => x['containerInstanceArn'],
  );
  const containerInstanceData = await awsCli(
    `ecs describe-container-instances --cluster ${ECS_CLUSTER_NAME} --container-instances ${containerInstanceARNs.join(
      ' ',
    )}`,
  );
  const containerInstanceToEc2InstanceID: { [key: string]: string } = {};
  const ec2InstanceIDs = containerInstanceData['containerInstances'].map(
    (x: any) => x['ec2InstanceId'],
  );
  for (const x of containerInstanceData['containerInstances']) {
    containerInstanceToEc2InstanceID[x['containerInstanceArn']] =
      x['ec2InstanceId'];
  }
  const instanceData = await awsCli(
    `ec2 describe-instances --instance-ids ${ec2InstanceIDs.join(' ')}`,
  );
  const instanceIDToIP: { [key: string]: string } = {};
  for (const instanceGroup of instanceData['Reservations']) {
    for (const i of instanceGroup['Instances']) {
      instanceIDToIP[i['InstanceId']] = i['PublicDnsName'];
    }
  }
  const table = new Table({ title: 'Tasks' });
  const namespaceToColor: { [key: string]: string } = {};
  let colorIndex = 0;

  for (const task of taskData['tasks'].sort((a: any, b: any) =>
    a['group'].localeCompare(b['group']),
  )) {
    const revision = task['containers'][0]['image'].split(':')[1].slice(0, 6);
    const namespace = task['group'].split('service:')[1].split('_')[0];
    if (namespaceToColor[namespace] === undefined) {
      namespaceToColor[namespace] =
        TERMINAL_COLORS[colorIndex % TERMINAL_COLORS.length];
      colorIndex += 1;
    }
    const createdAt = new Date(
      1000 * parseInt(task['createdAt']),
    ).toLocaleString();

    table.addRow(
      {
        group: task['group'].split('service:')[1],
        status: task['lastStatus'],
        health: task['healthStatus'],
        revision: revision,
        createdAt: createdAt,
        instanceID:
          containerInstanceToEc2InstanceID[task['containerInstanceArn']] ||
          'N/A',
        instanceIP:
          instanceIDToIP[
            containerInstanceToEc2InstanceID[task['containerInstanceArn']]
          ] || 'N/A',
      },
      {
        color: namespaceToColor[namespace],
      },
    );
  }
  table.printTable();
}

async function listInstances() {
  const containerInstanceARNs = (
    await awsCli(`ecs list-container-instances --cluster ${ECS_CLUSTER_NAME}`)
  )['containerInstanceArns'];
  const containerInstanceData = await awsCli(
    `ecs describe-container-instances --cluster ${ECS_CLUSTER_NAME} --container-instances ${containerInstanceARNs.join(
      ' ',
    )}`,
  );
  const containerInstanceToEc2InstanceID: { [key: string]: string } = {};
  const ec2InstanceIDs = containerInstanceData['containerInstances'].map(
    (x: any) => x['ec2InstanceId'],
  );
  for (const x of containerInstanceData['containerInstances']) {
    containerInstanceToEc2InstanceID[x['containerInstanceArn']] =
      x['ec2InstanceId'];
  }
  const instanceData = await awsCli(
    `ec2 describe-instances --instance-ids ${ec2InstanceIDs.join(' ')}`,
  );
  const instanceIDToData: { [key: string]: any } = {};
  for (const instanceGroup of instanceData['Reservations']) {
    for (const i of instanceGroup['Instances']) {
      instanceIDToData[i['InstanceId']] = i;
    }
  }
  const table = new Table({ title: 'EC2 Instances' });
  for (const ciData of containerInstanceData['containerInstances']) {
    const ec2InstanceID = ciData['ec2InstanceId'];
    const remainingResources = ciData['remainingResources'];
    const registeredResources = ciData['registeredResources'];

    const registeredMemory = registeredResources.filter(
      (x: any) => x['name'] === 'MEMORY',
    )[0]['integerValue'];
    const remainingMemory = remainingResources.filter(
      (x: any) => x['name'] === 'MEMORY',
    )[0]['integerValue'];
    const registeredCPU = registeredResources.filter(
      (x: any) => x['name'] === 'CPU',
    )[0]['integerValue'];
    const remainingCPU = remainingResources.filter(
      (x: any) => x['name'] === 'CPU',
    )[0]['integerValue'];

    const totalCPU = registeredCPU + remainingCPU;
    const totalMemory = registeredMemory + remainingMemory;
    const cpuPercent = Math.round((100 * registeredCPU) / totalCPU);
    const memoryPercent = Math.round((100 * registeredMemory) / totalMemory);
    const details = instanceIDToData[ec2InstanceID];
    let color = 'cyan';
    if (ciData['pendingTasksCount'] > 0) {
      color = 'red';
    }

    table.addRow(
      {
        status: ciData['status'],
        type: details['InstanceType'],
        running: ciData['runningTasksCount'],
        pending: ciData['pendingTasksCount'],
        'cpu used': `${registeredCPU}/${totalCPU} (${cpuPercent}%)`,
        'memory used': `${registeredMemory}/${totalMemory} (${memoryPercent}%)`,
        ip: details['PublicDnsName'],
      },
      { color: color },
    );
  }
  table.printTable();
}

async function getAllServiceNames(): Promise<string[]> {
  const result = await awsCli(`ecs list-services --cluster ${ECS_CLUSTER_NAME}`);
  const serviceARNs = result['serviceArns'];
  const serviceDetails = await describeServices(serviceARNs);
  const services: string[] = [];
  for (const details of serviceDetails) {
    services.push(details['serviceName']);
  }
  return services;
}

async function showService(name: string) {
  const result = await awsCli(`ecs list-services --cluster ${ECS_CLUSTER_NAME}`);
  const serviceARNs = result['serviceArns'];
  const serviceDetails = await describeServices(serviceARNs);
  const eventsTable = new Table({ title: 'Services' });
  const deploymentsTable = new Table();
  for (const details of serviceDetails) {
    if (details['serviceName'] === name) {
      for (const d of details['deployments']) {
        deploymentsTable.addRow({
          status: d['status'],
          task: d['taskDefinition'].split('/')[1],
          running: d['runningCount'],
          desired: d['desiredCount'],
          pending: d['pendingCount'],
          failed: d['failedTasks'],
          state: d['rolloutState'],
        });
      }
      for (const event of details['events']) {
        event['id'] = event['id'].slice(0, 7);
        eventsTable.addRow(event);
        if (eventsTable.table.rows.length === 5) {
          break;
        }
      }
      deploymentsTable.printTable();
      eventsTable.printTable();
      return;
    }
  }
  console.log('Could not find service by that name');
}

async function createService(inputFile: string) {
  return await awsCli(
    `ecs create-service --cli-input-json file://${inputFile}`,
  );
}

function verifyDeploymentFile(contents: any) {
  let foundError = false;
  if (contents['namespace'] === undefined || contents['namespace'] === '') {
    console.log('Please define a valid namespace for this file');
    foundError = true;
  }
  if (contents['namespace'].includes('_')) {
    console.log('Namespace cannot have underscores');
    foundError = true;
  }
  const seenIDs: string[] = [];
  for (const d of contents['deployments']) {
    if (d['id'] === undefined || d['id'].length === 0) {
      console.log('Each deployment must have a valid id');
      foundError = true;
    }
    if (seenIDs.includes(d['id'])) {
      console.log(`Deployment ID: ${d['id']} is not unique`);
      foundError = true;
    }
    seenIDs.push(d['id']);
  }
  if (foundError) {
    throw 'Please fix errors before continuing';
  }
}

async function roleInfo(role: string, verbose: boolean) {
  let result = await awsCli('ec2 describe-instances');
  let nameToInstance = new Map<string, any>();
  for (let reservations of result['Reservations']) {
    for (let instance of reservations['Instances']) {
      let name = '';
      let matches = false;
      for (let tag of instance['Tags']) {
        if (tag['Key'] === 'Role' && tag['Value'] === role) {
          matches = true;
        }
        if (tag['Key'] === 'Name') {
          name = tag['Value'];
        }
      }
      if (matches && instance['State']['Name'] === 'running') {
        nameToInstance.set(name, instance);
      }
    }
  }
  if (verbose) {
    console.log('Name\t\t\tIP');
    nameToInstance.forEach(function (value, instance_name, map) {
      const publicDnsName = nameToInstance.get(instance_name)['PublicDnsName'];
      console.log(`${instance_name}\t${publicDnsName}`);
    });
  }
  return Array.from(nameToInstance.values());
}

async function describeServices(serviceARNs: string[]): Promise<any> {
  const chunkSize = 10;
  let result: any[] = [];
  for (let i = 0; i < serviceARNs.length; i += chunkSize) {
    const chunk = serviceARNs.slice(i, i + chunkSize);
    const serviceDetails = await awsCli(
      `ecs describe-services --cluster ${ECS_CLUSTER_NAME} --services ${chunk.join(
        ' ',
      )}`,
    );
    result = result.concat(serviceDetails['services']);
  }
  return result;
}

program.parse();