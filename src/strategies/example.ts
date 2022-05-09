import { randomUUID } from 'crypto';
import { roundToNearestStep, toNum } from "@/helpers";
import logger from "@/logger";
import ShareTradeConfig from "@/tradeShare";
import { Share } from "invest-nodejs-grpc-sdk/dist/generated/instruments";
import { Candle } from "invest-nodejs-grpc-sdk/dist/generated/marketdata";
import { OrderDirection, OrderState, OrderType, PostOrderRequest } from "invest-nodejs-grpc-sdk/dist/generated/orders";
import { Quotation } from "invest-nodejs-grpc-sdk/src/generated/common";
import { IStrategy } from ".";


/**
 * Стратегия работает по принципу "Купил дешевле, продал дороже"
 */
class ExampleStrategy implements IStrategy {
  private readonly config: ShareTradeConfig;
  private readonly instrumentInfo: Share;

  private lastTradesInfo = {
    sell: { price: Infinity, quantity: 0 },
    buy: { price: -Infinity, quantity: 0 },
  };
  private processingQuantity = {
    buy: 0,
    sell: 0,
  };
  private processingMoney = 0;
  private holdingSharesQuantity = 0;
  private leftAvailableBalance = 0;

  // ID выставленных заявок
  private processingOrders = {
    buy: null,
    sell: null,
  };
  // ID последних обработанных сделок
  private lastProcessedStages = {
    buy: null,
    sell: null,
  };


  constructor(share: Share, config: ShareTradeConfig) {
    if (!share || !config) {
      throw new Error('Необходимо предоставить информацию об инструменте!');
    }
    this.config = config;
    this.instrumentInfo = share;

    this.leftAvailableBalance = config.maxBalance;
  }

  * onCandle(candle: Candle): Generator<Partial<PostOrderRequest>> {
    logger.info(`[Example] ${this.instrumentInfo.ticker} Получена новая свеча ${candle.time}\n`
    + `Держим ${this.holdingSharesQuantity} last buy ${this.lastTradesInfo.buy.price} ${this.lastTradesInfo.buy.quantity} \n`
    + `last sell ${this.lastTradesInfo.sell.price} ${this.lastTradesInfo.sell.quantity} \n`
    + `processing: ${this.processingQuantity.buy} (buy), ${this.processingQuantity.sell} (sell) \n`
    + `balance: ${this.leftAvailableBalance}, processing: ${this.processingMoney}`
    );
    const high = toNum(candle.high);
    const low = toNum(candle.low);

    // Округляем цену с учетом шага цены инструмента
    const buyPrice = roundToNearestStep(
      Number(low) + this.config.commission,
      toNum(this.instrumentInfo.minPriceIncrement),
    );
    // Если мы можем купить дешевле, чем продавали
    if (buyPrice + this.config.priceStep < this.lastTradesInfo.sell.price) {
      // Сколько лотов теоретически можем купить
      const availableToBuy = this.config.maxToTradeAmount - this.processingQuantity.buy - this.holdingSharesQuantity;

      let lotsToBuy = Math.floor(availableToBuy);
      // Если денег на покупку не хвататет, уменьшаем кол-во лотов, пока их не хватит
      while(lotsToBuy * buyPrice > this.leftAvailableBalance - this.processingMoney) {
        lotsToBuy--;
      }
      if (lotsToBuy > 0) {
        this.processingQuantity.buy += lotsToBuy;
        this.processingMoney += buyPrice * lotsToBuy;
        // Возвращаем заявку на покупку
        // Мы учитываем комиссию при расчетах, но не учитываем при выставлении заявки, так как это делает брокер
        const request = this.makeBuyOrder(candle.low, lotsToBuy);
        this.processingOrders.buy = request.orderId;
        yield request;
        /*
          Так как эта стратегия не предусматривает выставление встречной заявки на продажу,
          то после выставления заявки на покупку мы завершаем обработку свечи.
          Если нужно выставлять также встречную заявку, то следует убрать return
        */
        return;
      }
    }

    // Логика расчета продажи обратна логике покупки
    const sellPrice = roundToNearestStep(
      Number(high) + this.config.commission,
      toNum(this.instrumentInfo.minPriceIncrement),
    );
    if (sellPrice - this.config.priceStep > this.lastTradesInfo.buy.price) {
      const availableToSell = Math.floor(this.holdingSharesQuantity - this.processingQuantity.sell);
      
      if (availableToSell > 0) {
        this.processingQuantity.sell += availableToSell;
        
        const request = this.makeSellOrder(candle.high, availableToSell);
        this.processingOrders.sell = request.orderId;
        yield request;
      }
    }
    
    return;
  }

  cancelPreviousOrder(candle: Candle): string {
    if (this.lastTradesInfo.buy.price > toNum(candle.close)) {
      const maxDecrease = (this.lastTradesInfo.buy.price / 100) * this.config.cancelBuyOrderIfPriceGoesBelow;
      const decrease = this.lastTradesInfo.buy.price - toNum(candle.close);
      if (decrease >= maxDecrease) {
        return this.processingOrders.buy;
      }
    }
    if (this.lastTradesInfo.sell.price < toNum(candle.close)) {
      const maxIncrease = (this.lastTradesInfo.sell.price / 100) * this.config.cancelSellOrderIfPriceGoesAbove;
      const increase = toNum(candle.close) - this.lastTradesInfo.sell.price;
      if (increase >= maxIncrease) {
        return this.processingOrders.sell;
      }
    }
  }

  async onChangeOrder(order: OrderState): Promise<void> {
    try {
      const latestStage = order.stages[order.stages.length - 1];
      const isSell = order.direction == OrderDirection.ORDER_DIRECTION_SELL
      || order.orderId === this.processingOrders.sell;
      const isBuy = order.direction == OrderDirection.ORDER_DIRECTION_BUY
        || order.orderId === this.processingOrders.buy || order.direction == 0;
      const isExecuted = order.lotsRequested == order.lotsExecuted;

      if (!latestStage && !isExecuted) return;
      
      // Если заявка выполнена полностью, то обнуляем процессинг заявок
      if (isExecuted) {
        if (isSell) {
          this.processingOrders.sell = null;
        } else if (isBuy) {
          this.processingOrders.buy = null;
        }
      }
      const lastProcessedStageId = isBuy ? this.lastProcessedStages.buy : this.lastProcessedStages.sell;

      // Выходим, если уже учли эту сделку
      if (latestStage && latestStage.tradeId === lastProcessedStageId) {
        return;
      }

      const { price, quantity } = isExecuted && !latestStage
        ?  { price: order.executedOrderPrice, quantity: order.lotsExecuted }
        : latestStage;
      
      if (isSell) {
        this.lastProcessedStages.sell = (latestStage || {}).tradeId;
      } else if (isBuy) {
        this.lastProcessedStages.buy = (latestStage || {}).tradeId;
      }
      if (isBuy) {
        logger.info(`[Example] ${this.instrumentInfo.ticker} Покупка завершена. Цена: ${toNum(price)}, кол-во: ${quantity}`);
        this.holdingSharesQuantity += quantity;
        this.leftAvailableBalance -= toNum(price);
        this.processingQuantity.buy -= quantity;
      } else if (isSell) {
        logger.info(`[Example] ${this.instrumentInfo.ticker} Продажа завершена. Цена: ${toNum(price)}, кол-во: ${quantity}`);
        this.holdingSharesQuantity -= quantity;
        this.leftAvailableBalance += toNum(price);
        this.processingMoney -= toNum(price) * quantity;
        this.processingQuantity.sell -= quantity;
      } else {
        logger.warning(`[Example] Неизвестное направление заявки: ${order.direction} ${JSON.stringify(this.processingOrders)} \n ${JSON.stringify(order)}`);
      }

      logger.info(`[Example] ${this.instrumentInfo.ticker} Осталось денег: ${this.leftAvailableBalance}\n`
        + `Держим лотов: ${this.holdingSharesQuantity}\n`
        + `В обработке: ${this.processingQuantity.buy} покупка, ${this.processingQuantity.sell} продажа`);
    } catch (e) {
      logger.error(`Ошибка при обработке изменения заявки: ${e.message}`);
    }
  }

  private makeBuyOrder(price: Quotation, quantity: number): Partial<PostOrderRequest> {
    return {
      figi: this.instrumentInfo.figi,
      quantity,
      price,
      direction: OrderDirection.ORDER_DIRECTION_BUY,
      orderType: OrderType.ORDER_TYPE_LIMIT,
      orderId: randomUUID(),
    };
  }

  private makeSellOrder(price: Quotation, quantity: number): Partial<PostOrderRequest> {
    return {
      figi: this.instrumentInfo.figi,
      quantity,
      price,
      direction: OrderDirection.ORDER_DIRECTION_SELL,
      orderType: OrderType.ORDER_TYPE_LIMIT,
      orderId: randomUUID(),
    };
  }
}

export default ExampleStrategy;
