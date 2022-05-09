import * as winston from "winston";
import * as util from 'util';
import * as TelegramLogger from 'winston-telegram';
import { OrderDirection, OrderState, OrderType, PostOrderRequest } from "invest-nodejs-grpc-sdk/dist/generated/orders";
import { toNum } from "./helpers";


interface ExtendedLogger extends winston.Logger {
  deal: (ticker: string, order: PostOrderRequest, ...args: any) => void;
  cancelOrder: (ticker: string, order: OrderState, ...args: any) => void;
};

const format = winston.format.combine(
  winston.format.timestamp({
    format: "YY-MM-DD HH:MM:SS",
  }),

  winston.format.printf(
    info => {
      const args = info[Symbol.for('splat') as any];
      if (args) { info.message = util.format(info.message, ...args); }
      return `[${info.timestamp}] ${info.level}: ${info.message}`
    },
  ),
);

const levels: any = {
  ...winston.config.syslog.levels,
  deals: 10,
  cancelOrder: 11,
};

const transports = [
  new winston.transports.Console({}),
  new winston.transports.File({
    filename: 'logs/logs.txt',
  }),
];

const logger = winston.createLogger({ format, levels, transports });

if (process.env.TG_TOKEN && process.env.TG_CHAT_ID) {
  logger.add(new TelegramLogger({
    token: process.env.TG_TOKEN,
    chatId: Number(process.env.TG_CHAT_ID),
    level: 'deals',
    unique: true,
    template: 'Стратегия {message} \n {metadata.direction} {metadata.ticker} '
      + '{metadata.quantity} шт. по цене {metadata.price} ({metadata.orderType} заявка) \n'
      + ' ID заявки: {metadata.orderId} \n'
      + ' Аккаунт: {metadata.accountId}',
  }));
  logger.add(new TelegramLogger({
    token: process.env.TG_TOKEN,
    chatId: Number(process.env.TG_CHAT_ID),
    level: 'cancelOrder',
    unique: true,
    template: 'Отмена заявки по {metadata.ticker} '
      + '{metadata.quantity} шт. по цене {metadata.price} ({metadata.orderType} заявка) \n'
      + 'Исполнено {metadata.lotsExecuted} \n'
      + ' ID заявки: {metadata.orderId} \n'
      + ' Аккаунт: {metadata.accountId}',
  }));
}

(logger as ExtendedLogger).deal = (ticker: string, order: PostOrderRequest, ...args: any) => {
  logger.log({
    level: 'deals',
    message: args.join(' '),
    metadata: {
      ticker,
      ...order,
      price: toNum(order.price).toString(),
      orderType: order.orderType === OrderType.ORDER_TYPE_LIMIT ? 'Лимитная' : 'Рыночная',
      direction: order.direction === OrderDirection.ORDER_DIRECTION_BUY ? 'ПОКУПКА' : 'ПРОДАЖА',
    },
  });
}
(logger as ExtendedLogger).cancelOrder = (ticker: string, order: OrderState, ...args: any) => {
  logger.log({
    level: 'cancelOrder',
    message: args.join(' '),
    metadata: {
      ticker,
      ...order,
      price: toNum(order.initialOrderPrice).toString(),
      orderType: order.orderType === OrderType.ORDER_TYPE_LIMIT ? 'Лимитная' : 'Рыночная',
      direction: order.direction === OrderDirection.ORDER_DIRECTION_BUY ? 'ПОКУПКА' : 'ПРОДАЖА',
    },
  });
}


export default logger as ExtendedLogger;
