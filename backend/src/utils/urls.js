// Prints bare URLs on their own lines — terminals make these Ctrl+Click openable.
export function banner(lines, title = 'PeoplePay360') {
  const width = Math.max(title.length, ...lines.map((l) => l[0].length + l[1].length + 2));
  const bar = '─'.repeat(width + 4);
  console.log(`\n┌${bar}┐`);
  console.log(`│ ${title.padEnd(width + 2)} │`);
  console.log(`├${bar}┤`);
  for (const [label, url] of lines) {
    console.log(`│ ${(label + ' ').padEnd(width - url.length + 1)}${url} │`.replace(/\s+│$/, ' │'));
  }
  console.log(`└${bar}┘`);
  for (const [, url] of lines) console.log(`   ${url}`);
  console.log('');
}
