import { Module } from '@nestjs/common';
import { ClaimGateway } from './claim.gateway';

@Module({
  providers: [ClaimGateway],
  exports: [ClaimGateway],
})
export class WebsocketModule {}
