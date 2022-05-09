import * as readline from 'readline';


const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (question: string): Promise<string> => new Promise((resolve) => rl
  .question(`${question}\n Введите номер ответа: `, resolve));


type ChooseOption = {
  name: string;
  value: string;
}

export const chooseFromConsole = async (title: string, options: ChooseOption[]) => {
  try {
    console.log(title, ': ');
    const question = options.map((o, idx) => `  ${idx + 1}. ${o.name}`).join('\n');
    const chosen = await ask(question);

    if (!chosen) throw new Error('Вы не выбрали ничего');
    if (!options[Number(chosen) - 1]) throw new Error('Неверный номер ответа');
    return options[Number(chosen) - 1].value;
  } catch (e) {
    console.warn(`Ошибка выбора: ${e.message} \n Попробуйте снова\n`);
    return chooseFromConsole(title, options);
  }
};
