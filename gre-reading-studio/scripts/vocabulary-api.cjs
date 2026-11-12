/* Local-only OpenAI bridge. API credentials stay in this Node process. */
'use strict';
const http=require('node:http');
const {randomBytes,createHash,timingSafeEqual}=require('node:crypto');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const V=require('../dist/vocabulary.js');
const {createProgressStore}=require('./progress-store.cjs');

const DEFAULT_PORT=43187,DEFAULT_MODEL='gpt-4.1-mini';
const TOKEN_HEADER='x-gre-token';
const {ApiError,validateInput,validateOutput,requestBody,generate}=require('../dist/openai-vocabulary.js');
const Question=require('../dist/openai-question.js');
const problem=(status,code,message)=>new ApiError(status,code,message);
const hash=value=>createHash('sha256').update(value).digest();
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

function readJSON(req,limit=8192){
  return new Promise((resolve,reject)=>{
    let size=0,failed=false;const chunks=[];
    req.on('data',chunk=>{if(failed)return;size+=chunk.length;if(size>limit){failed=true;reject(problem(413,'BODY_TOO_LARGE','请求内容过大，请检查保存内容。'));return;}chunks.push(chunk);});
    req.on('end',()=>{if(failed)return;try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(problem(400,'INVALID_JSON','词汇请求格式错误。'));}});
    req.on('error',()=>reject(problem(400,'INVALID_REQUEST','词汇请求未完整发送。')));
  });
}

function createServer(options={}){
  let apiKey=(typeof options.apiKey==='string'?options.apiKey:(process.env.OPENAI_API_KEY||'')).trim();
  let model=options.model||process.env.OPENAI_MODEL||DEFAULT_MODEL;
  const token=options.token||randomBytes(32).toString('hex'),tokenHash=hash(token);
  const fetchImpl=options.fetchImpl||globalThis.fetch,timeoutMs=options.timeoutMs||45000;
  const cache=new Map(),pending=new Map();let active=0,configurationGeneration=0;
  const dataDirectory=path.resolve(options.dataDirectory||path.join(__dirname,'../user-data'));
  const progressStore=createProgressStore({directory:dataDirectory});
  const serviceStatus=()=>({configured:!!apiKey,model,features:{config:true,progress:true,shutdown:true,question:true},location:path.join(dataDirectory,'progress.json')});
  const server=http.createServer(async(req,res)=>{
    const address=server.address(),origin=`http://127.0.0.1:${address?.port}`;
    function reply(status,value){
      if(res.writableEnded||res.destroyed)return;
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));
    }
    try{
      if(req.headers.host!==`127.0.0.1:${address?.port}`)throw problem(403,'INVALID_HOST','本机服务仅接受本机地址访问。');
      if(req.headers.origin!=='null'&&req.headers.origin!==origin)throw problem(403,'INVALID_ORIGIN','请从阅间本机页面访问词汇服务。');
      res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');
      const route=req.url?.split('?')[0];
      if(!['/api/status','/api/vocabulary','/api/question','/api/config','/api/progress','/api/shutdown'].includes(route))throw problem(404,'NOT_FOUND','没有此服务接口。');
      if(req.method==='OPTIONS'){
        const method=req.headers['access-control-request-method'],headers=String(req.headers['access-control-request-headers']||'').toLowerCase().split(',').map(v=>v.trim()).filter(Boolean);
        if(!['GET','POST'].includes(method)||headers.some(header=>!['content-type',TOKEN_HEADER].includes(header)))throw problem(403,'INVALID_PREFLIGHT','词汇服务不接受此请求。');
        res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, X-GRE-Token');
        if(req.headers['access-control-request-private-network']==='true')res.setHeader('Access-Control-Allow-Private-Network','true');
        res.writeHead(204);res.end();return;
      }
      const provided=req.headers[TOKEN_HEADER];
      if(typeof provided!=='string'||provided.length>512||!timingSafeEqual(hash(provided),tokenHash))throw problem(401,'LOCAL_AUTH_REQUIRED','本机连接已失效，请用 AI 生词启动器重新打开阅间。');
      if(route==='/api/status'&&req.method==='GET'){reply(200,serviceStatus());return;}
      if(route==='/api/progress'&&req.method==='GET'){reply(200,{...await progressStore.read(),location:path.join(dataDirectory,'progress.json')});return;}
      if(['/api/config','/api/progress','/api/shutdown'].includes(route)&&req.method==='POST'){
        if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw problem(415,'JSON_REQUIRED','此接口仅接受 JSON 请求。');
        const body=await readJSON(req,route==='/api/progress'?85*1024*1024:8192);
        if(route==='/api/config'){
          if(!isObject(body))throw problem(400,'INVALID_CONFIG','请在网页中输入有效的 API Key。');
          if(body.clear===true)apiKey='';
          else{
            if(typeof body.apiKey!=='string'||!body.apiKey.trim()||body.apiKey.length>4096||/[\s\x00-\x1f]/.test(body.apiKey.trim()))throw problem(400,'INVALID_CONFIG','API Key 不能为空或包含空白字符。');
            if(body.model!==undefined&&(typeof body.model!=='string'||!/^[A-Za-z0-9._:-]{1,100}$/.test(body.model)))throw problem(400,'INVALID_CONFIG','模型名称格式不正确。');
            apiKey=body.apiKey.trim();if(body.model)model=body.model;
          }
          configurationGeneration++;cache.clear();reply(200,serviceStatus());return;
        }
        if(route==='/api/progress'){reply(200,{...await progressStore.write(body),location:path.join(dataDirectory,'progress.json')});return;}
        reply(200,{stopped:true});apiKey='';configurationGeneration++;cache.clear();server.close();server.closeIdleConnections();return;
      }
      if(!['/api/vocabulary','/api/question'].includes(route)||req.method!=='POST')throw problem(405,'METHOD_NOT_ALLOWED','AI 接口请求方式不正确。');
      if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw problem(415,'JSON_REQUIRED','词汇接口仅接受 JSON 请求。');
      const questionRoute=route==='/api/question';
      const input=(questionRoute?Question.validateInput:validateInput)(await readJSON(req,questionRoute?10*1024*1024:8192));
      if(!apiKey.trim())throw problem(503,'KEY_NOT_CONFIGURED','尚未配置 OpenAI API Key，请通过本机 AI 生词启动器配置。');
      // A changed or cleared key starts a new generation; existing authorized requests may finish.
      const generation=configurationGeneration;
      const key=questionRoute?JSON.stringify([generation,model,route,createHash('sha256').update(JSON.stringify(input)).digest('hex')]):JSON.stringify([generation,model,input.word,input.context,input.relationMode]);
      if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);reply(200,value);return;}
      if(pending.has(key)){reply(200,await pending.get(key));return;}
      if(active>=2)throw problem(429,'LOCAL_BUSY','正在处理其他 AI 请求，请稍后再试。');
      active++;
      const task=(questionRoute?Question.generate:generate)(input,{apiKey,model,fetchImpl,timeoutMs:questionRoute?(options.questionTimeoutMs||options.timeoutMs||60000):timeoutMs}).then(value=>{if(generation===configurationGeneration){cache.set(key,value);if(cache.size>500)cache.delete(cache.keys().next().value);}return value;}).finally(()=>{active--;pending.delete(key);});
      pending.set(key,task);reply(200,await task);
    }catch(error){const safe=error instanceof ApiError||error instanceof Question.ApiError||String(error?.code||'').startsWith('PROGRESS_')?error:problem(500,'INTERNAL_ERROR','本机服务发生错误，请重新启动后重试。');reply(safe.status||500,{error:safe.message,code:safe.code,...(safe.code==='PROGRESS_CONFLICT'?{current:safe.current}: {})});}
  });
  server.requestTimeout=10000;server.headersTimeout=10000;
  return {server,token};
}

function browserURL(port,token){
  const file=pathToFileURL(path.resolve(__dirname,'../dist/index.html'));
  file.hash='gre-ai='+encodeURIComponent(JSON.stringify({url:`http://127.0.0.1:${port}`,token}));return file.href;
}
function writeLaunchPage(port,token,{directory=path.resolve(__dirname,'../.local')}={}){
  const destination=browserURL(port,token);
  const html=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])).replace(/[^\x00-\x7f]/gu,char=>`&#${char.codePointAt(0)};`);
  // A browser redirect carries the fragment; Windows file associations need only
  // open this plain HTML path. Neither the page nor the URL contains an API key.
  const script=JSON.stringify(destination).replace(/[<>&\u2028\u2029]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
  const content=`<!doctype html>\n<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html('阅间 · 连接 AI 生词')}</title></head><body><h1>${html('正在连接阅间')}</h1><p>${html('正在打开原来的阅间页面，并连接本机 AI 生词服务。')}</p><p><a id="open-reading" href="${html(destination)}">${html('未自动打开时，点击这里')}</a></p><script>window.location.replace(${script});</script></body></html>\n`;
  fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'ai-launch.html');
  fs.writeFileSync(file,content,{encoding:'ascii',mode:0o600});
  return file;
}
function openBrowser(url){
  // Pass the URL through a process environment variable, never interpolate it into shell code.
  let child;const browserEnv={...process.env};delete browserEnv.OPENAI_API_KEY;
  if(process.platform==='win32')child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command','Start-Process -FilePath $env:GRE_AI_BROWSER_URL'],{env:{...browserEnv,GRE_AI_BROWSER_URL:url},windowsHide:true,stdio:'ignore'});
  else child=spawn(process.platform==='darwin'?'open':'xdg-open',[url],{env:browserEnv,stdio:'ignore'});
  child.on('error',()=>process.stderr.write('无法自动打开浏览器。请确认系统已设置默认浏览器。\n'));
}
async function main(){
  const port=Number(process.env.GRE_AI_PORT||DEFAULT_PORT);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('GRE_AI_PORT 必须是 1–65535 之间的端口号。');
  const {server,token}=createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  process.stdout.write(`阅间 AI 生词服务已启动：http://127.0.0.1:${port}\n模型：${process.env.OPENAI_MODEL||DEFAULT_MODEL}\n关闭此窗口或按 Ctrl+C 可停止服务。\n`);
  if(!process.env.OPENAI_API_KEY?.trim())process.stdout.write('尚未配置 API Key，当前只能检查连接状态。\n');
  if(process.argv.includes('--open')){
    openBrowser(writeLaunchPage(port,token));
    process.stdout.write('已打开本机连接页。已有阅间页面可刷新，或点击“检查连接”。\n');
  }
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));
}
if(require.main===module)main().catch(error=>{process.stderr.write(error?.code==='EADDRINUSE'?'AI 生词服务端口已被占用，请关闭旧服务窗口后重试。\n':'无法启动 AI 生词服务，请检查 Node.js、端口设置和系统权限。\n');process.exitCode=1;});
module.exports={createServer,validateInput,validateOutput,requestBody,browserURL,writeLaunchPage,DEFAULT_PORT,DEFAULT_MODEL};
