import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ExternalController } from './external/external.controller';
import { ExternalService } from './external/external.service';

@Module({
  imports: [],
  controllers: [AppController, ExternalController],
  providers: [AppService, ExternalService],
})
export class AppModule {}
