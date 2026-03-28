// modules/ingredients.js
// 模組 2：食材清單管理
// 處理食材的新增、減少、更新到 Notion

const notion = require('../utils/notion');
const claudeAI = require('../utils/claude');

/**
 * 主要處理函式：解析輸入並更新食材庫
 * @param {string} userInput - 使用者輸入，例如「番茄 +6個」
 * @returns {string} - 回傳給使用者的訊息
 */
async function handleIngredientUpdate(userInput) {
  // 用 Claude 解析輸入
  const parsed = await claudeAI.parseIngredientInput(userInput);

  if (!parsed) {
    return '抱歉，我沒看懂這個輸入 😅\n\n格式範例：\n・番茄 +6個\n・豬五花 +300g 冷凍\n・牛奶 +1瓶 到期3/30\n・番茄 -2';
  }

  const { action, name, quantity, unit, storage, expiryDate, isUncertain } = parsed;

  // 查詢食材庫是否已有此食材
  const existingPage = await notion.findIngredientByName(name);

  if (action === 'add') {
    return await handleAdd(existingPage, { name, quantity, unit, storage, expiryDate, isUncertain });
  } else if (action === 'remove') {
    return await handleRemove(existingPage, { name, quantity });
  }

  return '無法判斷是要增加還是減少食材，請確認輸入格式。';
}

/**
 * 處理食材增加
 */
async function handleAdd(existingPage, data) {
  const { name, quantity, unit, storage, expiryDate, isUncertain } = data;
  const today = new Date().toISOString().split('T')[0];

  // 決定儲存方式（預設冷藏）
  const finalStorage = storage || '冷藏';

  if (existingPage) {
    // 已有此食材 → 更新數量
    const currentQty = existingPage.properties['數量']?.number || 0;
    const newQty = isUncertain ? null : (currentQty + (quantity || 0));

    await notion.updateIngredient(existingPage.id, {
      quantity: newQty,
      unit: unit || existingPage.properties['單位']?.rich_text?.[0]?.plain_text || '',
      hasIt: true,
      storage: finalStorage,
      addedDate: today,
      ...(expiryDate && { expiryDate })
    });

    let msg = `✅ 已更新「${name}」`;
    if (!isUncertain && quantity) {
      msg += `\n數量：${currentQty} → ${newQty}${unit || ''}`;
    }
    if (storage) msg += `\n保存：${finalStorage}`;
    if (expiryDate) msg += `\n到期日：${expiryDate}`;
    return msg;

  } else {
    // 新食材 → 自動分類並建立
    const tag = await claudeAI.classifyIngredient(name);

    await notion.createIngredient({
      name,
      quantity: isUncertain ? null : quantity,
      unit: unit || '',
      storage: finalStorage,
      expiryDate,
      addedDate: today
    });

    let msg = `✅ 已新增「${name}」到食材庫`;
    if (!isUncertain && quantity) msg += `\n數量：${quantity}${unit || ''}`;
    msg += `\n分類：${tag}`;
    if (storage) msg += `\n保存：${finalStorage}`;
    if (expiryDate) msg += `\n到期日：${expiryDate}`;
    return msg;
  }
}

/**
 * 處理食材減少
 */
async function handleRemove(existingPage, data) {
  const { name, quantity } = data;

  if (!existingPage) {
    return `找不到「${name}」在食材庫中，請先新增它。`;
  }

  const currentQty = existingPage.properties['數量']?.number;

  if (currentQty !== null && currentQty !== undefined) {
    const newQty = Math.max(0, currentQty - (quantity || 1));
    const hasIt = newQty > 0;

    await notion.updateIngredient(existingPage.id, {
      quantity: newQty,
      hasIt
    });

    if (newQty === 0) {
      return `✅「${name}」已用完，已標記為沒有`;
    }
    const unit = existingPage.properties['單位']?.rich_text?.[0]?.plain_text || '';
    return `✅ 已更新「${name}」\n數量：${currentQty}${unit} → ${newQty}${unit}`;
  } else {
    // 沒有記錄數量的情況，直接標記為沒有
    await notion.updateIngredient(existingPage.id, { hasIt: false });
    return `✅「${name}」已標記為用完`;
  }
}

/**
 * 取得現有食材清單（格式化文字）
 */
async function getIngredientListText() {
  const ingredients = await notion.getAllIngredients();

  if (ingredients.length === 0) {
    return '目前食材庫是空的，可以輸入「番茄 +6個」來新增食材喔！';
  }

  // Tag emoji 對照
  const tagEmoji = {
    '肉類': '🥩', '蛋白質': '🥚', '蔬菜': '🥦', '調料': '🧂',
    '穀物': '🌾', '乳製品': '🥛', '水果': '🍎', '海鮮': '🦐',
    '零食': '🍪', '其他': '🧺'
  };

  // 依 Tag 分組
  const grouped = {};
  for (const item of ingredients) {
    const tag = item.tag?.[0] || '其他';
    if (!grouped[tag]) grouped[tag] = [];
    grouped[tag].push(item);
  }

  let text = '🛒 食材庫（共 ' + ingredients.length + ' 樣）\n──────────────\n';
  for (const [tag, items] of Object.entries(grouped)) {
    const emoji = tagEmoji[tag] || '📦';
    text += '\n' + emoji + ' ' + tag + '\n';
    // 每行最多顯示 4 個，超過換行
    const chunks = [];
    for (let i = 0; i < items.length; i += 4) {
      chunks.push(items.slice(i, i + 4));
    }
    for (const chunk of chunks) {
      text += chunk.map(function(item) {
        const qty = item.quantity ? item.quantity + (item.unit || '') : '';
        const cold = item.storage === '冷凍' ? '❄' : '';
        return item.name + (qty ? '(' + qty + ')' : '') + cold;
      }).join('　') + '\n';
    }
  }

  return text.trim();
}

module.exports = {
  handleIngredientUpdate,
  getIngredientListText
};
