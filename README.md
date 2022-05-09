# Пример торгового бота на JavaScript

## Описание
Пример торгового бота на JavaScript с использование [Tinkoff Invest API] (https://tinkoff.github.io/investAPI/)

Фичи:
- Написание торговых стратегий максимально упрощено и заключается в написании непосредственно логики самой стратегии
- Уведомления о выставленных заявках в Telegram
- Бэктестинг на исторических данных
- Хранение журнала логов
- TypeScript

В качестве SDK используется [Invest NodeJS grpc SDK](https://github.com/mtvkand/invest-nodejs-grpc-sdk)
[Документация от Тинькофф](https://tinkoff.github.io/investAPI/)

## Предварительная настройка
Для начала работы следует указать следующие Environment переменные

```
TOKEN=токен для Tinkoff API V2 с полным доступом

TG_TOKEN=токен бота Telegram
TG_CHAT_ID=чат в Telegram
```
`TG_TOKEN` и `TG_CHAT_ID` следует указать, если необходимо получать уведомления о сделках в Telegram

Настроить конфигурацию для торговли, добавив нужные тикеры в переменную `shares` (файл `index.ts`).
В примере указана следующая конфигурация

```json
{
  candleInterval: SubscriptionInterval.SUBSCRIPTION_INTERVAL_ONE_MINUTE,
  maxBalance: 50,
  maxToTradeAmount: 10,
  priceStep: 0.01,
  commission: 0.01,
  cancelBuyOrderIfPriceGoesBelow: 1,
  cancelSellOrderIfPriceGoesAbove: 1,
  strategy: Strategies.Example,
}
```
Она означает что:
- Будет взят минутный таймфрейм (`candleInterval`)
- Алгоритму будет доступно 50 единиц валюты (`maxBalance`)
- Максимально будет торговаться 10 акций (`maxToTradeAmount`)
- Минимальная выгода от сделки должна быть не менее 0.01 (`priceStep`).  То есть выгодной будет считаться сделка на продажу, где цена больше на 0.01 чем цена прошлой покупки. Аналогично для покупки
- Комиссия сделки составляет 0.01 на лот (`commission`). То есть комиссия при сделке в 10 лотов будет рассчитана как 10 * 0.01 = 0.1
- Предыдущая сделка на покупку будет отменена, если цена (`candle.close`) упадет на 1% (`cancelBuyOrderIfPriceGoesBelow`) от цены последней покупки
- Предыдущая сделка на продажу будет отменена, если цена (`candle.close`) повысится на 1% (`cancelSellOrderIfPriceGoesAbove`) от цены последней продажи
- Будет использован алгоритм Example (`strategy`)

## Начало работы
Для запуска в режиме [Sandbox](https://tinkoff.github.io/investAPI/head-sandbox/#_4) установите переменную `isSandbox` (файл `index.ts`) в значение `true`.
Для запуска на исторических данных выкачайте исторические данные с помощью метода [GetCandles](https://tinkoff.github.io/investAPI/marketdata/#getcandles), сохраните как .json файл и укажите путь до файла (относительно файла `index.ts`) в переменной `backtestingFilePath` (файл `index.ts`). По умолчанию, данные приходят с интервалом в 1000мс, это настраивается через переменную `simulateInterval` (файл `index.ts`).
Пример файла c историческими данными - [veon_2022_04_25_1min.json](https://github.com/DRublev/tinkoff-contest-js-example/blob/main/veon_2022-04-25_1min.json).

```sh
npm run build && npm run start
```

## How to
### Доабвить новую стратегию
 - Дополнить enum `Strategies` [src/strategies/index.ts](https://github.com/DRublev/tinkoff-contest-js-example/blob/main/src/strategies/index.ts)
 - Создать файл для стратегии в папке [src/strategies](https://github.com/DRublev/tinkoff-contest-js-example/blob/main/src/strategies) и имплементировать интерфейс `IStrategy`. Пример - [Example стратегия](https://github.com/DRublev/tinkoff-contest-js-example/blob/main/src/strategies/example.ts)
 - Описать торговую логику в созданном файле
 - Указать инструментам в торговом конфиге новую стратегию
