import { Injectable } from '@nestjs/common';

@Injectable()
export class ExternalService {
  async handleHeliusWebHook(requestBody: any) {
    console.log('RECIEVED HELIUS WEBHOOK THING');
    console.log(requestBody);
    return {};
  }
}
