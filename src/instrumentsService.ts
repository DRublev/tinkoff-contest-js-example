
import { InstrumentStatus, Share } from "invest-nodejs-grpc-sdk/dist/generated/instruments";
import logger from "./logger";
import { InvestSdk } from "./types";


class InstrumentsService {
  private readonly client: InvestSdk;

  constructor(client: InvestSdk) {
    if (!client) throw new Error('client is required');
    this.client = client;
  }

  /**
   * Получить интрументы по списку тикеров и отфильтровать по доступности их для торговли
   * @param candidates - Список тикеров для получения информации о них
   * @returns Картеж из доступных и недоступных для торговли инструментов
   */
  public async filterByAvailable(candidates: string[]): Promise<[Share[], Share[]]> {
    try {
      const allShares = await this.client.instruments.shares({
        instrumentStatus: InstrumentStatus.INSTRUMENT_STATUS_BASE,
      });
      const available = allShares.instruments
        .filter((share) => candidates.includes(share.ticker));
      const notAvailable = candidates
        .filter((ticker) => !available.some((c) => c.ticker === ticker))
        .map((ticker) => ({ ticker })) as Share[];

      return [available, notAvailable];
    } catch (e) {
      logger.error(`Ошибка при фильтрации инструментов: ${e.message}`);
      return [[], candidates.map((ticker) => ({ ticker })) as Share[]];
    }
  }
}

export default InstrumentsService;
