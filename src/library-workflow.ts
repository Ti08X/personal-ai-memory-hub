import {WorkflowEntrypoint,type WorkflowEvent,type WorkflowStep} from 'cloudflare:workers';
import {NonRetryableError} from 'cloudflare:workflows';
import {Store} from './store';
import {MemoryLibrary,libraryPrincipal} from './memory-library';
import {ApiError,type Env,type Principal} from './core';
type Payload={owner:string;client:string};
export class MemoryLibraryWorkflow extends WorkflowEntrypoint<Env,Payload>{
 async run(event:WorkflowEvent<Payload>,step:WorkflowStep){
  // Durable state contains identifiers and sanitized counts only, never plaintext.
  const execute=async(stage:'extract'|'summarize')=>{
   let principal:Principal;try{principal=await libraryPrincipal(this.env,event.payload.owner,event.payload.client);}catch(e){if(e instanceof ApiError&&e.status===403)throw new NonRetryableError(e.code);throw e;}
   const library=new MemoryLibrary(new Store(this.env,principal));
   if(!await library.enabled())return {status:'paused'};
   return stage==='extract'?library.extract():library.summarize();
  };
  const rounds=[];
  for(let round=0;round<8;round++){
  const extraction=await step.do('extract-current-sources-'+round,{retries:{limit:2,delay:'10 seconds',backoff:'exponential'},timeout:'4 minutes'},()=>execute('extract'));
  const summaries=await step.do('update-affected-summary-'+round,{retries:{limit:2,delay:'10 seconds',backoff:'exponential'},timeout:'4 minutes'},()=>execute('summarize'));
  rounds.push({extraction,summaries});
  if(['paused','busy'].includes(extraction.status)||extraction.status==='idle'&&summaries.status==='idle')break;
  }
  return {rounds};
 }
}
