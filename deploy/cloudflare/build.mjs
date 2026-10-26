import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, cpSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const result=spawnSync('npm',['run','build'],{cwd:join(root,'apps/web'),stdio:'inherit',env:{...process.env,STATIC_EXPORT:'true',NEXT_PUBLIC_MONITORING_ENABLED:'true',NEXT_PUBLIC_RELEASE:revision,MONITORING_SOURCE_MAPS:'true'}});
if(result.status!==0)process.exit(result.status??1);
const assets=join(root,'apps/web/out/_next/static');
const maps=join(root,'.local/sourcemaps',revision);
mkdirSync(maps,{recursive:true});cpSync(assets,maps,{recursive:true});
function strip(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())strip(p);else if(e.name.endsWith('.map'))rmSync(p);}}
strip(join(root,'apps/web/out'));
writeFileSync(join(root,'.local/sourcemaps/current-release'),revision);
console.log('Private source maps prepared; public output contains no .map files.');
