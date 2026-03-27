// utils/flex.js
function buildRecipeCard(recipe, ingredients, missingList, suggestions) {
  const ok = missingList.length === 0;
  const rows = (ingredients || []).slice(0,8).map(ing => ({
    type:"box",layout:"horizontal",contents:[
      {type:"text",text:ing.hasIt?"✅":"❌",size:"sm",flex:0},
      {type:"text",text:ing.name,size:"sm",color:"#555",flex:1,margin:"sm"}
    ]
  }));
  const extraContent = [];
  if(missingList.length>0){
    extraContent.push({type:"text",text:"缺少："+missingList.join("、"),size:"xs",color:"#E74C3C",margin:"sm",wrap:true});
    if(suggestions&&suggestions.length>0){
      extraContent.push({type:"text",text:"💡 買了還能做："+suggestions.join("、"),size:"xs",color:"#27AE60",margin:"xs",wrap:true});
    }
  }
  const prepArr = recipe.prepNote ? [{type:"separator",margin:"md"},{type:"text",text:"📝 "+recipe.prepNote,size:"xs",color:"#888",margin:"md",wrap:true}] : [];
  const stepsArr = recipe.steps ? [{type:"separator",margin:"md"},{type:"text",text:"👨‍🍳 料理步驟",weight:"bold",size:"sm",margin:"md"},{type:"text",text:recipe.steps.substring(0,200),size:"xs",color:"#555",wrap:true,margin:"xs"}] : [];
  const cats = (recipe.category||[]).slice(0,3).map(c=>({type:"box",layout:"vertical",backgroundColor:"#FF6B35",cornerRadius:"4px",paddingAll:"4px",margin:"xs",contents:[{type:"text",text:c,size:"xs",color:"#fff"}]}));
  const body = {type:"box",layout:"vertical",contents:[
    {type:"text",text:recipe.name||"食譜",weight:"bold",size:"xl",color:"#1A1A1A",wrap:true},
    {type:"box",layout:"horizontal",margin:"sm",contents:cats},
    {type:"separator",margin:"md"},
    {type:"text",text:ok?"✅ 食材齊全":"⚠️ 缺 "+missingList.length+" 樣",size:"sm",color:ok?"#27AE60":"#E74C3C",margin:"md",weight:"bold"},
    ...rows,...extraContent,...prepArr,...stepsArr
  ]};
  const footerContents = [];
  if(recipe.tutorialUrl) footerContents.push({type:"button",style:"primary",color:"#FF6B35",height:"sm",action:{type:"uri",label:"查看原始貼文",uri:recipe.tutorialUrl}});
  if(recipe.notionUrl) footerContents.push({type:"button",style:"secondary",height:"sm",action:{type:"uri",label:"Notion 食譜",uri:recipe.notionUrl}});
  return {type:"flex",altText:"🍳 "+(recipe.name||"食譜"),contents:{type:"bubble",
    styles:{header:{backgroundColor:"#FF6B35"},footer:{backgroundColor:"#F8F8F8"}},
    header:{type:"box",layout:"vertical",contents:[{type:"text",text:"🍳 食譜推薦",color:"#fff",size:"sm",weight:"bold"}]},
    body,
    footer:footerContents.length>0?{type:"box",layout:"vertical",spacing:"sm",contents:footerContents}:undefined
  }};
}

function buildRecipeList(recipes, title) {
  const items = recipes.slice(0,10).map((r,i)=>({
    type:"bubble",size:"micro",
    body:{type:"box",layout:"vertical",contents:[
      {type:"text",text:(i+1)+". "+r.name,weight:"bold",size:"sm",wrap:true,color:"#1A1A1A"},
      {type:"text",text:r.status==="complete"?"✅":r.missingCount>0?"⚠️缺"+r.missingCount+"樣":"❓",size:"xs",color:r.status==="complete"?"#27AE60":"#E74C3C",margin:"xs"},
      {type:"text",text:(r.category||[]).join("／"),size:"xxs",color:"#888",margin:"xs"}
    ]},
    footer:{type:"box",layout:"vertical",contents:[{type:"button",style:"primary",color:"#FF6B35",height:"sm",action:{type:"message",label:"選這道",text:String(i+1)}}]}
  }));
  return {type:"flex",altText:"📋 "+title,contents:{type:"carousel",contents:items}};
}

function buildCategoryQuickReply(isRandom) {
  return {type:"text",text:isRandom?"好！請選擇哪類料理（我直接幫你挑一道！）":"今天想吃什麼？請選擇類型：",quickReply:{items:[
    {type:"action",action:{type:"message",label:"主食",text:"1"}},
    {type:"action",action:{type:"message",label:"配菜蔬菜",text:"2"}},
    {type:"action",action:{type:"message",label:"配菜肉類",text:"3"}},
    {type:"action",action:{type:"message",label:"配菜其他",text:"4"}},
    {type:"action",action:{type:"message",label:"湯品",text:"5"}},
    {type:"action",action:{type:"message",label:"甜點",text:"6"}}
  ]}};
}

function buildDaysQuickReply() {
  return {type:"text",text:"好！要規劃幾天的餐點？",quickReply:{items:[
    {type:"action",action:{type:"message",label:"3天",text:"3"}},
    {type:"action",action:{type:"message",label:"5天",text:"5"}},
    {type:"action",action:{type:"message",label:"7天",text:"7"}}
  ]}};
}

function buildMealPlanFlex(plan, days) {
  const bubbles = plan.plan.map(d=>({type:"bubble",size:"kilo",body:{type:"box",layout:"vertical",contents:[
    {type:"text",text:d.day,weight:"bold",size:"md",color:"#FF6B35"},
    {type:"separator",margin:"sm"},
    {type:"box",layout:"horizontal",margin:"sm",contents:[{type:"text",text:"🌅",size:"sm",flex:0},{type:"text",text:d.breakfast||"—",size:"sm",flex:1,margin:"sm",wrap:true,color:"#555"}]},
    {type:"box",layout:"horizontal",margin:"xs",contents:[{type:"text",text:"☀️",size:"sm",flex:0},{type:"text",text:d.lunch||"—",size:"sm",flex:1,margin:"sm",wrap:true,color:"#555"}]},
    {type:"box",layout:"horizontal",margin:"xs",contents:[{type:"text",text:"🌙",size:"sm",flex:0},{type:"text",text:d.dinner||"—",size:"sm",flex:1,margin:"sm",wrap:true,color:"#555"}]}
  ]}}));
  return {type:"flex",altText:days+"天餐點規劃",contents:{type:"carousel",contents:bubbles}};
}

module.exports = {buildRecipeCard,buildRecipeList,buildCategoryQuickReply,buildDaysQuickReply,buildMealPlanFlex};