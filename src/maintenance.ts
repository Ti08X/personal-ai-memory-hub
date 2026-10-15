// Temporary source freeze during consistent export/cutover. No D1 access.
export {MemoryLibraryWorkflow} from './library-workflow';
export default {
 async scheduled(){},
 async fetch(){return Response.json({error:'migration_in_progress',message:'记忆系统正在迁移，数据已保留，请稍后重试。'},{status:503,headers:{'retry-after':'300','cache-control':'no-store'}});}
};
