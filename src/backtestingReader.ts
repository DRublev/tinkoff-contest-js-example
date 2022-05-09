import * as fs from 'fs';
import * as path from 'path';
import { Candle } from "invest-nodejs-grpc-sdk/dist/generated/marketdata";
import { sleep } from './helpers';

class BacktestingReader {
  private readonly pathToFile: string;

  constructor(pathToFile: string) {
    if (!pathToFile) {
      throw new TypeError('pathToFile is required');
    }
    this.pathToFile = path.resolve(pathToFile);
    if (!fs.existsSync(this.pathToFile)) {
      throw new TypeError(`Файл ${this.pathToFile} не найден`);
    }
  }


  /**
   * Читает содержимое файла и возвращает элемент раз в интервал
   * @param interval В милисекундах, default - 1000
   */
  async * readAsStream(interval: number = 1000, abortSignal: AbortSignal = null): AsyncGenerator<{ candle: Candle }> {
    const content = JSON.parse(fs.readFileSync(this.pathToFile, 'utf8'));

    let idx = 0;
    while (idx < content.candles.length && !abortSignal?.aborted) {
      const candle = content.candles[idx];
      await sleep(interval);
      if (this.isValidCandle(candle)) {
        yield { candle };
      }
      idx++;
    } 
    return;
  }

  private isValidCandle(candle: Candle): boolean {
    return !!candle.open
      && !!candle.close
      && !!candle.high
      && !!candle.low
      && !!candle.time
      && !!candle.volume;
  }
}

export default BacktestingReader;
