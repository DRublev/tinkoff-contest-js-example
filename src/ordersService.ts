import { OrderState, PostOrderRequest } from "invest-nodejs-grpc-sdk/dist/generated/orders";
import logger from "./logger";
import { InvestSdk } from "./types";

class OrdersService {
  private readonly client: InvestSdk;
  private readonly isSandbox: boolean;

  private lastWatchedStages: Record<string, string> = {}

  constructor(client: InvestSdk, isSandbox: boolean) {
    if (!client) throw new Error('client is required');
    this.client = client;
    this.isSandbox = isSandbox;
  }

  /**
   * @param order - Объект заявки
   * @returns Id заявки
   */
  public async postOrder(order: PostOrderRequest): Promise<string> {
    let posted;
    if (this.isSandbox) {
      posted = await this.client.sandbox.postSandboxOrder(order);
    } else {
      posted = await this.client.orders.postOrder(order);
    }
    return posted.orderId;
  }

  public async checkOrderState(accountId: string, orderId: string): Promise<OrderState> {
    let order: OrderState;
    if (this.isSandbox) {
      order = await this.client.sandbox.getSandboxOrderState({ accountId, orderId });
    } else {
      order = await this.client.orders.getOrderState({ accountId, orderId });
    }
    if (!order) {
      logger.error(`Заявка ${orderId} не найдена`);
      return;
    }
    const latestStage = order.stages[order.stages.length - 1];
    if (latestStage) {
      if (latestStage.tradeId !== this.lastWatchedStages[orderId]) {
        this.lastWatchedStages[orderId] = latestStage.tradeId;
        return order;
      }
    } else if (order.lotsExecuted === order.lotsRequested) {
      if (this.lastWatchedStages[orderId] !== order.orderId) {
        this.lastWatchedStages[orderId] = order.orderId;
        return order;
      }
    }
  }

  public async cancelOrder(accountId: string, orderId: string) {
    logger.info(`Отменяю заявки ${orderId}`);
    let order: OrderState;
    if (this.isSandbox) {
      order = await this.client.sandbox.getSandboxOrderState({ accountId, orderId });
      await this.client.sandbox.cancelSandboxOrder({ accountId, orderId });
    } else {
      order = await this.client.orders.getOrderState({ accountId, orderId });
      await this.client.orders.cancelOrder({ accountId, orderId });
    }
    if (order) {
      logger.cancelOrder(order.figi, order);
    }
  }

  public async cancelAllOrders(accountId: string): Promise<void> {
    let orders: OrderState[];
    if (this.isSandbox) {
      const response = await this.client.sandbox.getSandboxOrders({ accountId });
      orders = response.orders;
    } else {
      const response = await this.client.orders.getOrders({ accountId });
      orders = response.orders;
    }

    for (const order of orders) {
      logger.info(`Отмена заявки ${order.orderId}`);
      if (this.isSandbox) {
        await this.client.sandbox.cancelSandboxOrder({ accountId, orderId: order.orderId });
      } else {
        await this.client.orders.cancelOrder({ accountId, orderId: order.orderId });
      }
    }
  }
}

export default OrdersService;
