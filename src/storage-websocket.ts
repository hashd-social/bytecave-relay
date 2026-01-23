/**
 * WebSocket Storage Relay
 * 
 * Maintains persistent WebSocket connections to storage nodes and routes
 * storage requests from browsers to the appropriate node.
 * 
 * Flow:
 * 1. Storage node connects to relay via WebSocket on startup
 * 2. Node sends 'register' message with peerId
 * 3. Browser sends 'storage-request' with peerId and data
 * 4. Relay routes request to node's WebSocket
 * 5. Node processes and sends 'storage-response' back
 * 6. Relay forwards response to browser
 */

import WebSocket, { WebSocketServer } from 'ws';
import { createServer, Server as HttpServer } from 'http';
import { logger } from './logger.js';

interface RegisterMessage {
  type: 'register';
  peerId: string;
  nodeId?: string;
}

interface StorageRequestMessage {
  type: 'storage-request';
  requestId: string;
  targetPeerId?: string; // Optional - relay will auto-select if not provided
  data: string; // base64 encoded blob
  contentType: string;
  authorization?: {
    signature: string;
    address: string;
    timestamp: number;
    nonce: string;
    appId: string;
    contentHash: string;
  };
}

interface StorageResponseMessage {
  type: 'storage-response';
  requestId: string;
  success: boolean;
  cid?: string;
  error?: string;
}

interface ErrorMessage {
  type: 'error';
  requestId?: string;
  error: string;
}

type Message = RegisterMessage | StorageRequestMessage | StorageResponseMessage | ErrorMessage;

interface NodeConnection {
  ws: WebSocket;
  peerId: string;
  nodeId?: string;
  connectedAt: number;
}

interface PendingRequest {
  browserWs: WebSocket;
  requestId: string;
  timestamp: number;
}

export class StorageWebSocketRelay {
  private wss: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;
  private nodeConnections: Map<string, NodeConnection> = new Map(); // peerId -> connection
  private pendingRequests: Map<string, PendingRequest> = new Map(); // requestId -> pending request
  private port: number;

  constructor(port: number = 4003) {
    this.port = port;
  }

  async start(): Promise<void> {
    // Create HTTP server for WebSocket upgrade
    this.httpServer = createServer();
    
    // Create WebSocket server
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws: WebSocket) => {
      logger.info('[Storage WS] New WebSocket connection');

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as Message;
          this.handleMessage(ws, message);
        } catch (error: any) {
          logger.error('[Storage WS] Failed to parse message:', error.message);
          this.sendError(ws, 'Invalid message format');
        }
      });

      ws.on('close', () => {
        // Find and remove node connection
        for (const [peerId, conn] of this.nodeConnections.entries()) {
          if (conn.ws === ws) {
            logger.info('[Storage WS] Node disconnected:', peerId);
            this.nodeConnections.delete(peerId);
            break;
          }
        }
      });

      ws.on('error', (error: Error) => {
        logger.error('[Storage WS] WebSocket error:', error);
      });
    });

    // Start HTTP server
    await new Promise<void>((resolve) => {
      this.httpServer!.listen(this.port, () => {
        logger.info(`[Storage WS] WebSocket relay listening on port ${this.port}`);
        resolve();
      });
    });

    // Cleanup old pending requests every 30 seconds
    setInterval(() => this.cleanupPendingRequests(), 30000);
  }

  private handleMessage(ws: WebSocket, message: Message): void {
    switch (message.type) {
      case 'register':
        this.handleRegister(ws, message);
        break;
      case 'storage-request':
        this.handleStorageRequest(ws, message);
        break;
      case 'storage-response':
        this.handleStorageResponse(ws, message);
        break;
      default:
        logger.warn('[Storage WS] Unknown message type:', (message as any).type);
        this.sendError(ws, 'Unknown message type');
    }
  }

  private handleRegister(ws: WebSocket, message: RegisterMessage): void {
    const { peerId, nodeId } = message;

    if (!peerId) {
      this.sendError(ws, 'Missing peerId in register message');
      return;
    }

    // Store node connection
    this.nodeConnections.set(peerId, {
      ws,
      peerId,
      nodeId,
      connectedAt: Date.now()
    });

    logger.info('[Storage WS] Node registered:', { peerId, nodeId, totalNodes: this.nodeConnections.size });

    // Send confirmation
    ws.send(JSON.stringify({
      type: 'registered',
      peerId,
      timestamp: Date.now()
    }));
  }

  private handleStorageRequest(ws: WebSocket, message: StorageRequestMessage): void {
    const { requestId, data, contentType, authorization } = message;
    let { targetPeerId } = message;

    if (!requestId || !data) {
      this.sendError(ws, 'Missing required fields in storage request', requestId);
      return;
    }

    // Auto-select a storage node if targetPeerId not provided
    if (!targetPeerId) {
      const availableNodes = Array.from(this.nodeConnections.values());
      if (availableNodes.length === 0) {
        this.sendError(ws, 'No storage nodes available', requestId);
        return;
      }
      // Select first available node (could be improved with load balancing)
      targetPeerId = availableNodes[0].peerId;
      logger.info('[Storage WS] Auto-selected storage node:', targetPeerId.slice(0, 12));
    }

    // Find target node connection
    const nodeConn = this.nodeConnections.get(targetPeerId);
    if (!nodeConn) {
      this.sendError(ws, `Storage node ${targetPeerId.slice(0, 12)} not connected`, requestId);
      return;
    }

    // Store pending request
    this.pendingRequests.set(requestId, {
      browserWs: ws,
      requestId,
      timestamp: Date.now()
    });

    // Forward request to storage node
    try {
      nodeConn.ws.send(JSON.stringify({
        type: 'storage-request',
        requestId,
        data,
        contentType,
        authorization
      }));

      logger.info('[Storage WS] Forwarded storage request:', {
        requestId,
        targetPeerId: targetPeerId.slice(0, 12),
        dataSize: data.length
      });
    } catch (error: any) {
      logger.error('[Storage WS] Failed to forward request:', error.message);
      this.sendError(ws, 'Failed to forward request to storage node', requestId);
      this.pendingRequests.delete(requestId);
    }
  }

  private handleStorageResponse(ws: WebSocket, message: StorageResponseMessage): void {
    const { requestId, success, cid, error } = message;

    // Find pending request
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      logger.warn('[Storage WS] Received response for unknown request:', requestId);
      return;
    }

    // Forward response to browser
    try {
      pending.browserWs.send(JSON.stringify({
        type: 'storage-response',
        requestId,
        success,
        cid,
        error
      }));

      logger.info('[Storage WS] Forwarded storage response:', {
        requestId,
        success,
        cid: cid?.slice(0, 16)
      });
    } catch (error: any) {
      logger.error('[Storage WS] Failed to forward response:', error.message);
    }

    // Cleanup
    this.pendingRequests.delete(requestId);
  }

  private sendError(ws: WebSocket, error: string, requestId?: string): void {
    try {
      ws.send(JSON.stringify({
        type: 'error',
        requestId,
        error
      }));
    } catch (e: any) {
      logger.error('[Storage WS] Failed to send error:', e.message);
    }
  }

  private cleanupPendingRequests(): void {
    const now = Date.now();
    const timeout = 60000; // 60 seconds

    for (const [requestId, pending] of this.pendingRequests.entries()) {
      if (now - pending.timestamp > timeout) {
        logger.warn('[Storage WS] Request timed out:', requestId);
        this.sendError(pending.browserWs, 'Storage request timed out', requestId);
        this.pendingRequests.delete(requestId);
      }
    }
  }

  getStats() {
    return {
      connectedNodes: this.nodeConnections.size,
      pendingRequests: this.pendingRequests.size,
      nodes: Array.from(this.nodeConnections.values()).map(conn => ({
        peerId: conn.peerId.slice(0, 12),
        nodeId: conn.nodeId,
        connectedAt: conn.connectedAt
      }))
    };
  }

  async stop(): Promise<void> {
    if (this.wss) {
      this.wss.close();
    }
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
    }
    this.nodeConnections.clear();
    this.pendingRequests.clear();
    logger.info('[Storage WS] WebSocket relay stopped');
  }
}
