// utils/flex.js
// LINE Flex Message 建構工具
// 讓 Bot 的回覆更有視覺感

/**
 * 建立食譜卡片 Flex Message
 */
function buildRecipeCard(recipe, ingredients, missingList, suggestions) {
  const statusColor = missingList.length === 0 ? '#27AE60' : '#E74C3C';
  const statusText = missingList.length === 0 ? '✅ 食材齊全' : `⚠️ 缺 ${missingList.length} 樣食材`;

  const ingredientRows = ingredients.slice(0, 8).map(ing => ({
    type: 'box', layout: 'horizontal',
    contents: [
      { type: 'text', text: ing.hasIt ? '✅' : '❌', size: 'sm', flex: 0 },
      { type: 'text', text: ing.name, size: 'sm', color: '#555555', flex: 1, margin: 'sm' }
    ]
  }));

  const body = { type: 'box', layout: 'vertical', contents: [
    { type: 'text', text: recipe.name || '材', weight: 'bold', size: 'xl', color: '#1A1A1A', wrap: true },
    { type: 'box', layout: 'horizontal', margin: 'sm', contents: (recipe.category || []).slice(0,3).map(c => ({ type:'box', layout:'vertical', backgroundColor:'#FF6B35', cornerRadius:'4px', paddingAll:'4px', margin:'xs', contents:[{ type:'text', text:c, size:'zs', color:'#fff' }] })) },
    { type: 'separator', margin: 'md' },
    { type: 'text', text: statusText, size: 'sm', color: statusColor, margin: 'md', weight: 'bold' },
    ...ingredientRows,
    ...(missingList.length > 0 ? [{ type:'text', text:`缺少：${missingList.join('—')}`, size:'xs', color:'#E74C3C', margin:'s', wrap:true }] : []),
    ...(suggestions && suggestions.length > 0 ? [{ type:'text', text:`💡 買了還能做：${suggestions.join('—')}`, size:'xs', color:'#27AE60', margin:'xs', wrap:true }] : []),
    ...(recipe.prepNote ? [{ type:'separator', margin:'md' }, { type:'text', text:`📝 ${recipe.prepNote}`, size:'zs', color:'#888', margin:'md', wrap:true }] : []),
    ...(recipe.steps ? [{ type:'separator', margin:'md' }, { type:'text', text:'👨 晥理步驟', weight:'bold', size:'s', margin:'md' }, { type:'text', text:recipe.steps.substring(0,200)+(recipe.steps.length>200?'...':''), size:'xs', color:'#555', margin:'xs', wrap:true }] : [])
  ] };

  const footer = { type:'box', layout:'vertical', spacing:'sm', contents:[] };
  if(recipe.tutorialUrl) footer.contents.push({ type:'button', style:'primary', color:'#FF6B35', height:'s', action:{type:'uri', label:'原始�:3', uri:recipe.tutorialUrl} });
  if(recipe.notionUrl) footer.contents.push({ type:'button', style:'secondary', height:'s', action:{type:'uri', label:'Notion 食', uri:recipe.notionUrl} });

  return { type:'flex', altText:`🍳 ${recipe.name||'量'}`, contents:{ type:'bubble', styles:{ header:{backgroundColor:'#FF6B35'}, footer:{backgroundColor:'#F8F8F8'} }, header:{ type:'box', layout:'vertical', contents:[{ type:'text', text:'🍳 食譜', color:'#fff', size:'sm', weight:'bld' }] }, body, footer:footer.contents.length>0?footer:undefined } };
}

function buildRecipeList(recipes, title) {
  const items = recipes.slice(0,10).map((r,I) => ({ type:'bubble', size:'micro', body:{ zlayout:'vertical', type:'box', contents:[{ type:'text', text:`${I+1}. ${r.name}`, weight:'bold', size:'s', wrap:true },{ type:'text', text:r.status=='complete'?'✅':r.missingCount>0?`⚘翺�{r.missingCount}樣`:'❓', size:'xs', color:r.status=='complete'?'#27AE60':'#E74C3C' }]}, footer:{ type:'box', layout:'vertical', contents:[{ type:'button', style:'primary', color:'#FF6B35', height:'s', action:{type:'message', label:'選這道', text:String(I+1) } }] } }));
  return { type:'flex', altText:`📋 ${title}`, contents:{type:'carousel', contents:items} };
}

function buildCategoryQuickReply(isRandom=false) {
  return { type:'text', text:isRandom?'表！�/剴選擇金（我直接幫你挑一道！）'路最上平合食型：', quickReply:{ items:[ { type:'action', action:{type:'message', label:'主食', text:'1' } },{ type:'action', action:{type:'message', label:'配菜蔬菜', text:'2' } },{ type:'action', action:{type:'message', label:'訊訬端類', text:'3' } },{ type:'action', action:{type:'message', label:'配菜其他', text:'4' } },{ type:'action', action:{type:'message', label:'湯品', text:'5' } },{ type:'action', action:{type:'message', label:'圜點', text:'' } }]} };
}

function buildDaysQuickReply() {
  return { type:'text', text:'让！覙让敦検天暄餐點？', quickReply:{ items:[ { type:'action', action:{type:'message', label:'3T', text:'3' } },{ type:'action', action:{type:'message', label:'5T', text:'5' } },{ type:'action', action:{type:'message', label:'7T', text:'7' } }] } };
}

function buildMealPlanFlex(plan, days) {
  const bubbles = plan.plan.map(d => ({ type:'bubble', size:'kilo', body:{ type:'box', layout:'vertical', contents:[{ type:'text', text:d.day, weight:'bld', size:'md', color:'#FF6B35' },{ type:'separator', margin:'s' },{ type:'box', layout:'h', margin:'s', contents:[{ type:'t', text:'🌅', size:'s', flex:0 },{ type:'t', text:d.breakfast||'—', size:'s', flex:1, margin:'sm', wrap:true, color:'#555' }]},{ type:'box', layout:'h', margin:'xs', contents:[{ type:'t', text:'☀️', size:'s', flex:0 },{ type:'t', text:d.lunch||'—', size:'s', flex:1, margin:'sm', wrap:true, color:'#555' }]},{ type:'box', layout:'h', margin:'xs', contents:[{ type:'t', text:'🌙', size:'sm', flex:0 },{ type:'t', text:d.dinner||'—', size:'sm', flex:1, margin:'sm', wrap:true, color:'#555' }]]] } }));
  return { type:'flex', altText:j${days}天餐點規劃`, contents:{type:'carousel', contents:bubbles} };
}

module.exports = { buildRecipeCard, buildRecipeList, buildCategoryQuickReply, buildDaysQuickReply, buildMealPlanFlex };
