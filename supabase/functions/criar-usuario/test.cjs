const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
let handler,state;
const q=table=>({select(){return this},eq(){return this},async maybeSingle(){return {data:state.actor,error:null}},async in(_,ids){return {data:ids.map(id=>({id})),error:null}},async insert(value){state.profile=value;return {error:state.profileError}}});
const service={auth:{async getUser(token){return {data:{user:token==='valid'?{id:'actor'}:null},error:null}},admin:{async createUser(input){state.created=input;return {data:{user:state.createError?null:{id:'created'}},error:state.createError}},async deleteUser(id){state.deleted=id;return {error:null}}}},from:q};
const source=fs.readFileSync(__dirname+'/index.ts','utf8').replace(/^import .*;\n/,'');
vm.runInNewContext(stripTypeScriptTypes(source),{createClient:()=>service,Request,Response,Number,Deno:{env:{get:()=>''},serve:fn=>handler=fn}});
const fresh=()=>state={actor:{perfil:'admin',ativo:true},profileError:null,createError:null};
const body={nome:'Maria',email:'maria@example.test',senha:'SenhaTest123!',perfil:'operador_coleta',rotas_coleta_ids:[1,2],ativo:false};
const call=(data=body,token='valid')=>handler(new Request('https://example.test',{method:'POST',headers:token?{Authorization:'Bearer '+token,'Content-Type':'application/json'}:{'Content-Type':'application/json'},body:JSON.stringify(data)}));
(async()=>{
 fresh();assert.equal((await call(body,'')).status,401);assert.equal(state.created,undefined);
 fresh();state.actor.perfil='operador_conferencia';assert.equal((await call()).status,403);assert.equal(state.created,undefined);
 fresh();state.actor.ativo=false;assert.equal((await call()).status,403);
 fresh();assert.equal((await call({...body,rotas_coleta_ids:[1,1]})).status,400);
 fresh();assert.equal((await call({...body,perfil:'operador_conferencia'})).status,400);
 fresh();assert.equal((await call(null)).status,400);
 fresh();const ok=await call();assert.equal(ok.status,201);assert.deepEqual(JSON.parse(JSON.stringify(state.created)),{email:body.email,password:body.senha,email_confirm:true});assert.equal(state.profile.nome,'Maria');assert.equal(state.profile.ativo,false);assert.equal(state.profile.senha,undefined);assert.equal((await ok.text()).includes(body.senha),false);
 fresh();state.profileError={message:'missing routes'};assert.equal((await call()).status,400);assert.equal(state.deleted,'created');
 fresh();state.createError={code:'email_exists'};assert.equal((await call()).status,400);assert.equal(state.profile,undefined);
 console.log('OK: criação individual, JWT, admin ativo, duas rotas, validações e limpeza em caso de falha.');
})().catch(e=>{console.error(e);process.exit(1)});

