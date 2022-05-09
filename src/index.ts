import 'dotenv/config';
import { EventEmitter } from 'events';
import { createSdk } from 'invest-nodejs-grpc-sdk';
import { Share } from 'invest-nodejs-grpc-sdk/dist/generated/instruments';
import { AccessLevel, AccountStatus, AccountType } from 'invest-nodejs-grpc-sdk/dist/generated/users';
import { PostOrderRequest } from 'invest-nodejs-grpc-sdk/dist/generated/orders';
import {
  MarketDataRequest,
  SubscriptionAction,
  SubscriptionInterval,
} from 'invest-nodejs-grpc-sdk/dist/generated/marketdata';

import ShareTradeConfig from './tradeShare';
import { Strategies } from './strategies';
import * as strategies from './strategies';
import AccountService from './accountService';
import { chooseFromConsole } from './consoleReader';
import { NoAccessException } from './exceptions';
import InstrumentsService from './instrumentsService';
import ExchangeService from './exchangeService';
import OrdersService from './ordersService';
import logger from './logger';
import BacktestingReader from './backtestingReader';
import { sleep } from './helpers';


if (!process.env.TOKEN) {
  logger.error('Необходимо подставить токен с полным доступ в переменную окружения TOKEN');
  process.exit(1);
}

// При значении true все заявки будут выставляться в режиме песочницы
let isSandbox = true;

// Если указан путь к файту, то будет использован контент файла, а не данные из рынка
// Также, автоматически будет выставлен режим песочницы
const backtestingFilePath = null; //'./veon_2022-04-25_1min.json';

const client = createSdk(process.env.TOKEN, 'DRublev');
const shares: { [ticker: string]: ShareTradeConfig } = {
  SPBE: {
    candleInterval: SubscriptionInterval.SUBSCRIPTION_INTERVAL_ONE_MINUTE,
    maxBalance: 50,
    maxToTradeAmount: 10,
    priceStep: 0.01,
    commission: 0.01,
    cancelBuyOrderIfPriceGoesBelow: 1,
    cancelSellOrderIfPriceGoesAbove: 1,
    strategy: Strategies.Example,
  },
};
const instrumentsService = new InstrumentsService(client);
const exchangeService = new ExchangeService(client);
const ordersService = new OrdersService(client, isSandbox);
const accountService = new AccountService(client, isSandbox);
let accountId;
let tradableShares: Share[] = [];

const killSwitch = new AbortController();

/**
 * Статус работы бирж
 * Формат { SPB: true/false }
 */
let exchangesStatuses = {};
let watchIntervalId = null;
let watchOrderIntervalIds = [];


/**
 * Список событий для подписки
 * Может быть расширен с расширением функционала
 * Например, при добавлении поддержки подписки на события стакана
 */
const events = {
  receive: (figi: string) => `receive:${figi}`,
};
const candlesEventEmitter = new EventEmitter();
async function* getSubscribeCandlesRequest() {
  while (!killSwitch.signal.aborted) {
    await sleep(1000);
    yield MarketDataRequest.fromPartial({
      subscribeCandlesRequest: {
        subscriptionAction: SubscriptionAction.SUBSCRIPTION_ACTION_SUBSCRIBE,
        instruments: tradableShares
          .map((share) => ({
            figi: share.figi,
            interval: shares[share.ticker].candleInterval,
          })),
      },
    });
  }
};

const start = async () => {
  try {
    await chooseAccount();
    await accountService.printAccountPositions(accountId);
    await accountService.printAccountPortfolio(accountId);

    await prepareSharesList();

    // Обновляем статус работы бирж с переодичностью в 1 час
    /* В качестве улучшения можно использовать механизм Pub/Sub
       и подписываться на события изменения статуса работы биржи из сервиса ExchangeService
     */
    await watchForExchangeTimetable();
    watchIntervalId = setInterval(watchForExchangeTimetable, 1000 * 60); // 1 час

    // Код для подчитски мусора и остановки бота в непредвиденных ситуациях
    // Отменяет все невыполненные заявки!
    process.on('SIGINT', async function () {
      killSwitch.abort();
      if (watchIntervalId) {
        clearInterval(watchIntervalId);
      }
      await ordersService.cancelAllOrders(accountId);
      watchOrderIntervalIds.forEach((id) => clearInterval(id));
    });

    let candlesStream;
    if (!backtestingFilePath) {
      candlesStream = await client.marketDataStream.marketDataStream(getSubscribeCandlesRequest());
    } else {
      logger.info('Запускаем бектестинг...');
      isSandbox = true;
      const simulateInterval = 1000;
      const backtestingReader = new BacktestingReader(backtestingFilePath);
      candlesStream = await backtestingReader.readAsStream(simulateInterval, killSwitch.signal);
    }
    const tradingPromises = tradableShares.map(startTrading);
    for await (const response of candlesStream) {
      // При получении новой свечи уведомляем всех подписчиков (коими являются стратегии) об этом
      if (response.candle) {
        candlesEventEmitter.emit(events.receive(response.candle.figi), response.candle);
      }
    }


    /*
    * Запуск псевдо-параллельной торговли по всем инструментов
    * В целях упрощения сделано на базе Promise.allSettled, эффективнее было бы использовать workerfarm или аналог
    */
    await Promise.allSettled(tradingPromises);
  } catch (e) {
    logger.emerg(e);
    // Если какая-либо операция была в процессе выполнения (например, цикл торговли) - она будет отменена
    killSwitch.abort();
  }
};

/**
 * Вывести список аккаунтов и выбрать один из них
 * @returns {Promise<void>} Устанавливает accountId, выбранный пользователем из консоли
 */
const chooseAccount = async () => {
  try {
    const allAccounts = await accountService.getList();

    const withTradeAccess = allAccounts
      .filter((account) => account.accessLevel === AccessLevel.ACCOUNT_ACCESS_LEVEL_FULL_ACCESS
        && account.type !== AccountType.ACCOUNT_TYPE_INVEST_BOX);

    const options = withTradeAccess.map((account) => ({
      name: `${account.name} | Статус: ${AccountStatus[account.status]} | Тип: ${AccountType[account.type]}`
        + ` | ${AccessLevel[account.accessLevel]}`,
      value: account.id,
    }));

    if (!options.length) {
      throw new NoAccessException('Нет аккаунта с доступом к торговле. Смените токен и попробуйте снова');
    }

    const chosen = await chooseFromConsole('Выберите аккаунт для торговли', options);
    accountId = chosen;

    return chosen;
  } catch (e) {
    if (e.name === 'NoAccessException') {
      logger.error(e.message);
      return process.exit(1);
    }

    logger.warning(`Ошибка при выборе аккаунта: ${e.message} \n Попробуйте снова`);
    return chooseAccount();
  }
};

/**
 * Получить список инструментов по конфигу, отфильтровать инструменты недоступные для торговли/покупки/продажи
 */
const prepareSharesList = async () => {
  try {
    logger.info('Подготавливаю список инструментов...');
    const [availableShares, notFoundShares] = await instrumentsService.filterByAvailable(Object.keys(shares));
    if (notFoundShares.length) {
      const tickers = notFoundShares.map(s => s.ticker).join(', \n');
      logger.warning(`Не найдены инструменты: ${tickers} \n Они будут проигнорированы`);
    }

    tradableShares = availableShares.filter((share) => {
      if (!share.apiTradeAvailableFlag) {
        logger.warning(`${share.ticker} недоступен для торговли`);
        return false;
      }
      if (!share.buyAvailableFlag) {
        logger.warning(`${share.ticker} недоступен для покупки`);
        return false;
      }
      if (!share.sellAvailableFlag) {
        logger.warning(`${share.ticker} недоступен для продажи`);
        return false;
      }

      return true;
    });

    if (!tradableShares.length) {
      logger.warning('Нет доступных инструментов для торговли');
      process.exit(0);
    }
    logger.info(`Запускаюсь на ${tradableShares.length} инструментах...`);
  } catch (e) {
    logger.error('Ошибка при получении списка активов', e.message);
    process.exit(1);
  }
};

const watchForExchangeTimetable = async () => {
  try {
    if (!tradableShares.length) return;
    // Получаем список бирж, на которых торгуются акции
    const exchanges = tradableShares.reduce((acc, share) => {
      if (!acc.includes(share.exchange)) {
        acc.push(share.exchange);
      }
      return acc;
    }, []);

    // Обновляем текущий статус для каждой из интересующих нас бирж
    for (const exchange of exchanges) {
      try {
        if (isSandbox) {
          exchangesStatuses[exchange] = true;
          continue;
        }
        const isWorking = await exchangeService.isWorking(exchange);
        logger.info(`Обновляю статус биржи ${exchange} - ${isWorking ? 'работает' : 'не работает'}`);
        exchangesStatuses[exchange] = isWorking;
      } catch (e) {
        logger.warning(`Ошибка при проверке работы биржи ${exchange}: ${e.message}`);
      }
    }
  } catch (e) {
    logger.error('Ошибка при получении расписания работы биржи', e.message);
  }
};

const startTrading = async (share: Share) => {
  try {
    const shareTradeConfig: ShareTradeConfig = shares[share.ticker];
    if (!shareTradeConfig) {
      throw new ReferenceError(`Не найден конфиг для инструмента ${share.ticker}`);
    }
    const strategyKey = Strategies[shareTradeConfig.strategy];
    if (!strategies[strategyKey]) {
      throw new ReferenceError(` Не найдена стратегия для торговли ${shareTradeConfig.strategy}`);
    }

    logger.info(`Запускаю стратегию ${strategyKey} для ${share.ticker}`);
    const strategy: strategies.IStrategy = new strategies[strategyKey](share, shareTradeConfig);

    if (!exchangesStatuses[share.exchange]) {
      logger.warning(share.ticker, share.exchange, 'не работает, ожидаем изменения статуса работы биржи');
      while (!exchangesStatuses[share.exchange] && !killSwitch.signal.aborted) {
        await sleep(1000 * 60);
      }
      logger.info(share.ticker, share.exchange, ' снова работает, продолжаем торговлю');
    }

    candlesEventEmitter.on(events.receive(share.figi), async function (candle) {
      try {
        if (killSwitch.signal.aborted) return;

        logger.info(`Получена свеча ${candle.figi}`, JSON.stringify(candle));

        try {
          const cancelOrder = strategy.cancelPreviousOrder(candle);
          
          if (cancelOrder) {
            logger.info(`Отменяю предыдущую заявку на ${share.ticker}`);
            await ordersService.cancelOrder(accountId, cancelOrder);
          }
        } catch (e) {
          logger.error(`Ошибка при закрытии предыдущей заяки ${share.ticker}: ${e.message}`);
        }

        const orders = strategy.onCandle(candle);
        if (orders) {
          for await (const order of orders) {
            try {
              order.accountId = accountId;
              const placedOrderId = await ordersService.postOrder(order as PostOrderRequest);
              if (placedOrderId) {
                logger.deal(share.ticker, (order as PostOrderRequest), strategyKey);
                logger.info(`Отправлена заявка ${placedOrderId} на инструмент ${share.ticker}`);

                const id = setInterval(async () => {
                  await checkOrder(strategy, placedOrderId, order);
                }, 1000);
                watchOrderIntervalIds.push(id);
              }

            } catch (e) {
              logger.error('Ошибка при выставлении заявки', candle, order, e.message);
            }
          }
        }
      } catch (e) {
        logger.error(share.ticker, `Ошибка при обработке свечи: ${e.message}`);
      }
    });
  } catch (e) {
    logger.error(share.ticker, ' Ошибка при торговле', e.message);
    if (!(e instanceof ReferenceError)) {
      console.info(share.ticker, ' Пытаемся снова');
      return startTrading(share);
    }
  }
};

const checkOrder = async (
  strategy: strategies.IStrategy, 
  placedOrderId: string,
  requestedOrder: Partial<PostOrderRequest>,
) => {
  try {
    const trade = await ordersService.checkOrderState(accountId, placedOrderId);
    if (trade) {
      await strategy.onChangeOrder({ ...trade, orderId: requestedOrder.orderId, direction: requestedOrder.direction });
    }
  } catch (e) {
    logger.error('Ошибка при отслеживании заявки', e.message, typeof e, Object.entries(e));
  }
}

start();
