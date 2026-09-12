import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { registerLookAround } from '../src/tools/look_around.js';

let look;
const blocks = [
  {name:'oak_leaves', position:new Vec3(1,65,0), boundingBox:'block'},
  {name:'leaf_litter', position:new Vec3(2,65,0), boundingBox:'empty'},
  {name:'oak_log', position:new Vec3(3,65,0), boundingBox:'block'},
];
const bot={entity:{position:new Vec3(0,65,0)}, minenessReady:true, inventory:{items:()=>[]}, players:{}, entities:{},
  registry:{biomes:{}, entitiesByName:{}},
  findBlocks:({matching})=>blocks.filter(matching).map(b=>b.position),
  blockAt:p=>blocks.find(b=>b.position.equals(p)) ?? {name:'air', boundingBox:'empty'},
};
registerLookAround({tool:(_name,_description,_schema,handler)=>{look=handler;}},bot,{state:()=>({})});
const state=JSON.parse((await look({radius:8, inspect:[...blocks.map(b=>b.position), new Vec3(4,65,0)]})).content[0].text);
assert.deepEqual(new Set(state.notable_blocks.map(b=>b.name)), new Set(['oak_leaves','leaf_litter','oak_log']));
assert.deepEqual(state.inspected_blocks.map(b=>[b.name,b.solid]), [['oak_leaves',true],['leaf_litter',false],['oak_log',true],['air',false]]);
console.log('look-around.test.js PASS');
