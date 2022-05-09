import logger from "./logger";
import { InvestSdk } from "./types";


class ExchangeService {
  private readonly client: InvestSdk;
  
  constructor(client: InvestSdk) {
    if (!client) throw new Error('client is required');
    this.client = client;
  }

  /**
   * Запрашивает расписание работы биржи по ее коду на текущий момент
   * @param {String} exchange Код биржи (SPB или MOEX)
   * @returns {Boolean} Возвращает true, если биржа доступна для торговли
   */
  public async isWorking(exchange: string): Promise<boolean> {
    try {
      const today = new Date();
      const schedule = await this.client.instruments.tradingSchedules({
        from: today,
        to: today,
        exchange,
      });

      const { startTime, endTime } = schedule.exchanges[0].days[0];

      return today > startTime && today < endTime;
    } catch (e) {
      logger.error(`Ошибка при проверке работы биржи: ${e.message}`);
      return false;
    }
  }
}

export default ExchangeService;
