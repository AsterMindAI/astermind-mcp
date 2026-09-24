import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['src/index.js'],
});
const client = new Client({ name: 'test', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log('TOOLS EXPOSED:', tools.length);
for (const t of tools) console.log('  -', t.name);

const docs = [
  'To reset your password, go to Settings > Security and click Reset Password.',
  'Our office is located in Wilmington, Delaware and open 9-5 EST.',
  'Password requirements: minimum 12 characters, one number, one symbol.',
  'The annual plan costs $199 and includes priority support.',
  'If you forgot your password, use the "Forgot password" link on the login page.',
  'Our mobile app is available on iOS and Android.',
  'Two-factor authentication can be enabled under Security settings.',
  'We accept Visa, Mastercard, and American Express.',
];

console.log('\n== filter_context call ==');
const r1 = await client.callTool({
  name: 'filter_context',
  arguments: { query: 'how do I reset my password', documents: docs, maxDocs: 3, minRelevance: 0.5 },
});
const parsed = JSON.parse(r1.content[0].text);
console.log('kept', parsed.keptDocs, '/', parsed.totalDocs, '| saved', parsed.savedTokens, 'tokens =', parsed.savedPct + '%');

console.log('\n== classify_text call ==');
const r2 = await client.callTool({
  name: 'classify_text',
  arguments: {
    text: 'the app crashes when I upload',
    categories: ['billing', 'technical_support', 'account'],
    examples: [
      { text: 'I was charged twice', label: 'billing' },
      { text: 'my invoice is wrong', label: 'billing' },
      { text: 'the app keeps crashing', label: 'technical_support' },
      { text: 'I get an error uploading', label: 'technical_support' },
      { text: 'reset my password', label: 'account' },
      { text: 'change my email', label: 'account' },
    ],
  },
});
console.log(JSON.parse(r2.content[0].text));

console.log('\n== count_tokens call ==');
const r3 = await client.callTool({ name: 'count_tokens', arguments: { text: docs } });
console.log(JSON.parse(r3.content[0].text));

await client.close();
console.log('\nMCP SERVER OK — client connected, listed tools, and called them.');
