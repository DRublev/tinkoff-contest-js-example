import {
  PortfolioPosition,
  PortfolioResponse,
  PositionsResponse,
} from "invest-nodejs-grpc-sdk/dist/generated/operations";
import { Account } from "invest-nodejs-grpc-sdk/dist/generated/users";
import { toNum } from "./helpers";
import logger from "./logger";
import { InvestSdk } from "./types";

export default class AccountService {
  private readonly client: InvestSdk;
  private readonly isSandbox: boolean;

  constructor(client: InvestSdk, isSandbox: boolean) {
    if (!client) throw new Error('client is required');
    this.client = client;
    this.isSandbox = isSandbox;
  }

  public async getList(): Promise<Account[]> {
    try {
      let response;
      if (this.isSandbox) {
        response = await this.client.sandbox.getSandboxAccounts({});
      } else {
        response = await this.client.users.getAccounts({});
      }
      return response.accounts;
    } catch (e) {
      logger.warning(`Ошибка при получении списка аккаунтов: ${e.message}`);
      return [];
    }
  }

  public async printAccountPositions(accountId: string): Promise<void> {
    try {
      let positions: PositionsResponse;
      if (this.isSandbox) {
        positions = await this.client.sandbox.getSandboxPositions({ accountId });
      } else {
        positions = await this.client.operations.getPositions({ accountId });
      }
      logger.info(`Позиции аккаунта ${accountId} \n`
        + `Денежные средста: ${positions.money.map((money) => `${money.currency} ${toNum(money)} `)} \n`,
      );
    } catch (e) {
      logger.warning(`Ошибка при получении позиций аккаунта: ${e.message}`);
    }
  }

  public async printAccountPortfolio(accountId: string): Promise<void> {
    try {
      let portfolio: PortfolioResponse;
      if (this.isSandbox) {
        portfolio = await this.client.sandbox.getSandboxPortfolio({ accountId });
      } else {
        portfolio = await this.client.operations.getPortfolio({ accountId });
      }
      logger.info(`Позиции аккаунта ${accountId} \n`
        + `Активы: \n ${portfolio.positions
          .filter(s => s.instrumentType === 'share')
          .map(this.formatShareMessage)
          .join('\n')} \n`,
      );
    } catch (e) {
      logger.warning(`Ошибка при получении портфолио аккаунта: ${e.message}`);
    }
  }

  private formatShareMessage(share: PortfolioPosition): string {
    return `${share.instrumentType} ${share.figi} \n`
      + (share.quantity ? `  Акций ${toNum(share.quantity)} \n` : '')
      + (share.quantityLots ? `  Лотов ${toNum(share.quantityLots)} \n` : '')
      + (share.averagePositionPrice ? `  Средняя цена ${toNum(share.averagePositionPrice)} \n` : '')
      + (share.currentPrice ? `  Текущая цена ${toNum(share.currentPrice)} \n` : '')
      + `--------`;
  }
}