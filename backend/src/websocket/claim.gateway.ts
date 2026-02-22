import { SubscribeMessage, WebSocketGateway, WebSocketServer, OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { claimEventEmitter } from '../services/indexingService';

@WebSocketGateway({
  transports: ['websocket'],
  adapter: undefined, // Will be set to Redis adapter later
})
export class ClaimGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  afterInit(server: Server) {
    // Listen for claim events and broadcast to user_address room
    claimEventEmitter.on('claim', (claimData) => {
      if (claimData && claimData.user_address) {
        this.broadcastClaimUpdate(claimData.user_address, claimData);
      }
    });
  }

  handleConnection(client: Socket) {
    // Client connected
  }

  handleDisconnect(client: Socket) {
    // Client disconnected
  }

  // Example: subscribe client to their user_address room
  @SubscribeMessage('subscribeToClaims')
  handleSubscribe(client: Socket, payload: { user_address: string }) {
    client.join(payload.user_address);
  }

  // Broadcast claim update to user_address room
  broadcastClaimUpdate(user_address: string, claimData: any) {
    this.server.to(user_address).emit('claimUpdate', claimData);
  }
}
