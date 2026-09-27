// DeepSeek API 终端测试：读取 notes/ 里第一条真实笔记，调用一次，打印 summary / question。
// 运行：node src/deepseek.test.js
// 前提：项目根目录有 .env，且填了真实的 DEEPSEEK_API_KEY。

const fs = require('fs');
const path = require('path');
const { generate } = require('./deepseek');

const NOTES_DIR = path.join(__dirname, '..', 'notes');

// 剥离 frontmatter（--- ... ---），只保留正文
function stripFrontmatter(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

async function main() {
  if (!fs.existsSync(NOTES_DIR)) {
    console.error('notes/ 目录不存在。');
    process.exit(1);
  }
  const files = fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith('.md'));
  if (files.length === 0) {
    console.error('notes/ 目录下没有 .md 笔记，先建一条再跑。');
    process.exit(1);
  }

  const file = files[0];
  const name = file.replace(/\.md$/, '');
  const content = fs.readFileSync(path.join(NOTES_DIR, file), 'utf-8');
  const body = stripFrontmatter(content);

  console.log(`测试笔记：${name}（notes/ 共 ${files.length} 条，取第 1 条）\n`);
  console.log('调用 DeepSeek ...\n');

  const { summary, question, usage } = await generate(name, body);

  console.log('summary :', summary);
  console.log('question:', question);
  if (usage) {
    console.log('\ntoken 用量:', JSON.stringify(usage));
    console.log(
      `  prompt=${usage.prompt_tokens}  completion=${usage.completion_tokens}  total=${usage.total_tokens}`
    );
  }
}

main().catch((e) => {
  console.error('调用失败：', e.message);
  process.exit(1);
});
