import { Body, Controller, Get, Post } from '@nestjs/common';
import { ExternalService } from './external.service';

@Controller('external')
export class ExternalController {
  constructor(public readonly externalService: ExternalService) {}

  @Post('helius-webhook')
  async handleHeliusWebbook(@Body() requestBody) {
    return await this.externalService.handleHeliusWebHook(requestBody);
  }
}
