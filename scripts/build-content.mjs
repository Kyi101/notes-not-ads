import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

const files = [
  'src/shared.js',
  'src/main.js',
  'src/inspector.js',
  'src/scanner.js',
  'src/replacer.js',
  'src/init.js'
];

let content = '(() => {\n';

for (const file of files) {
  const code = fs.readFileSync(path.join(root, file), 'utf8');
  // Split on either ending, or a CRLF checkout carries every \r into the bundle
  // as trailing whitespace on every line. The output is always LF.
  content += code.split(/\r?\n/).map(line => line ? `  ${line}` : '').join('\n') + '\n';
}

content += '})();\n';

fs.writeFileSync(path.join(root, 'src/content.js'), content);
console.log('Built src/content.js from modules.');
