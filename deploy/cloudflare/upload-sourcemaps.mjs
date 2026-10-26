import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
if(!process.env.BETTER_STACK_API_TOKEN){console.error('Set BETTER_STACK_API_TOKEN for private source map upload.');process.exit(1);}
const release=readFileSync(join(root,'.local/sourcemaps/current-release'),'utf8').trim();
if(!/^[a-f0-9]{40}$/.test(release))throw new Error('Invalid build revision');
const cli=join(root,'apps/web/node_modules/.bin/sentry-cli');
const r=spawnSync(cli,['sourcemaps','upload','--release',release,'--url-prefix','~/_next/static',join(root,'.local/sourcemaps',release)],{stdio:'inherit',env:{...process.env,SENTRY_AUTH_TOKEN:process.env.BETTER_STACK_API_TOKEN,SENTRY_URL:'https://us-west-2a-sourcemaps.betterstackdata.com/',SENTRY_ORG:'622845',SENTRY_PROJECT:'2811083'}});
process.exit(r.status??1);
