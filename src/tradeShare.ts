import { SubscriptionInterval } from 'invest-nodejs-grpc-sdk/dist/generated/marketdata';
import { Strategies } from './strategies';


type ShareTradeConfig = {
  candleInterval: SubscriptionInterval,
  /**
   * Максимальное количество денег, которое может быть использовано
   */
  maxBalance: number,
  /**
   * Максимальное количество лотов для торговли
   */
  maxToTradeAmount: number;
  /**
   * Минимальная разница цен (High и Low), при которой будет выставлена заявка
   * Комиссия учитывается автоматически, нет нужды включать ее в это значение
   */
  priceStep: number;
  /**
   * Размер комиссии при покупке/продаже 1 лота
   */
  commission: number;

  /**
   * Отменять заявку на покупку, если цена уменьшилась на
   * Поцентное значение
   */
  cancelBuyOrderIfPriceGoesBelow: number;
  
  
  /**
   * Отменять заявку на продажу, если цена увеличилась на
   * Поцентное значение
   */
  cancelSellOrderIfPriceGoesAbove: number;

  /**
   * Каким алгоритмом торговать
   */
  strategy: Strategies,
}

export default ShareTradeConfig;