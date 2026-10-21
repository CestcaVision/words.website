import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root} from '../apps/api/store.ts';

test('Windows launchers use CMD-compatible CRLF without UTF-8 BOM',()=>{
  for(const filename of ['启动网站.bat','首次安装.bat','配置向导.bat']){
    const content=readFileSync(path.join(root,filename),'utf8');
    assert.ok(content.startsWith('@echo off\r\n'),`${filename}: CMD requires a clean first line`);
    assert.ok(!/(?<!\r)\n/.test(content),`${filename}: lone LF can break CMD block parsing`);
    assert.ok(content.includes('cd /d "%~dp0"'),`${filename}: resolve from script directory`);
  }
});
