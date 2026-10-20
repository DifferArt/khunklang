/*
 * ขุนคลัง — ข้อมูลตั้งต้น (บัญชี / หมวด / ทรัพย์สิน / ปุ่มลัด / กฎ)
 * ไฟล์นี้ใช้ร่วมกันทั้งเว็บแอป (โหมดทดลอง) และ Apps Script (ตอนรัน setup ครั้งแรก)
 * เป็นตัวอย่างทั่วไป — หลังตั้งชีตแล้ว แก้ชื่อ/เพิ่ม/ลบได้ใน Google Sheet หรือในแอปโดยตรง
 */
var KK_SEED = {
  // kind: bank | ewallet | cash | credit (บัตรเครดิต/PayLater) | loan (บัตรกดเงินสด/เงินกู้)
  accounts: [
    { id: 'KB1', name: 'กสิกร ① ใช้จ่ายหลัก', kind: 'bank', currency: 'THB', icon: '🟢' },
    { id: 'KB2', name: 'กสิกร ②', kind: 'bank', currency: 'THB', icon: '🟢' },
    { id: 'BBL1', name: 'กรุงเทพ ①', kind: 'bank', currency: 'THB', icon: '🔵' },
    { id: 'BBL2', name: 'กรุงเทพ ②', kind: 'bank', currency: 'THB', icon: '🔵' },
    { id: 'KTB', name: 'กรุงไทย', kind: 'bank', currency: 'THB', icon: '🔹' },
    { id: 'UOB', name: 'UOB', kind: 'bank', currency: 'THB', icon: '🔷' },
    { id: 'GSB', name: 'ออมสิน', kind: 'bank', currency: 'THB', icon: '🌸' },
    { id: 'TTB', name: 'ttb', kind: 'bank', currency: 'THB', icon: '🟦' },
    { id: 'PAYONEER', name: 'Payoneer', kind: 'ewallet', currency: 'USD', icon: '🟠' },
    { id: 'SKRILL', name: 'Skrill', kind: 'ewallet', currency: 'THB', icon: '🟣' },
    { id: 'TMN', name: 'TrueMoney', kind: 'ewallet', currency: 'THB', icon: '🟧' },
    { id: 'CASH', name: 'เงินสด', kind: 'cash', currency: 'THB', icon: '💵' },
    { id: 'CC_BBL', name: 'บัตรเครดิต กรุงเทพ', kind: 'credit', currency: 'THB', icon: '💳' },
    { id: 'CC_UOB', name: 'บัตรเครดิต UOB', kind: 'credit', currency: 'THB', icon: '💳' },
    { id: 'SPAYLATER', name: 'SPayLater', kind: 'credit', currency: 'THB', icon: '🛍️' },
    { id: 'LOAN_UOB', name: 'บัตรกดเงินสด UOB', kind: 'loan', currency: 'THB', icon: '🏧' }
  ],

  assets: [
    { id: 'H_MAIN', name: 'บ้านที่อยู่', kind: 'house', icon: '🏠' },
    { id: 'H_RENT', name: 'บ้านให้เช่า', kind: 'house', icon: '🏘️' },
    { id: 'CAR_1', name: 'รถคันที่ 1', kind: 'car', icon: '🚗' },
    { id: 'CAR_2', name: 'รถคันที่ 2', kind: 'car', icon: '🚙' }
  ],

  // tax_tag: แท็กสำหรับสรุปภาษีในเฟส 6 (deduct_* = ลดหย่อนได้, biz_cost = ต้นทุนธุรกิจ)
  categories: [
    // ---------- รายรับ ----------
    { id: 'INC_SHUTTERSTOCK', type: 'income', group: '📷 Stock Photo', name: 'Shutterstock', default_account_id: 'PAYONEER' },
    { id: 'INC_ADOBE1', type: 'income', group: '📷 Stock Photo', name: 'Adobe Stock', default_account_id: 'PAYONEER' },
    { id: 'INC_GETTY', type: 'income', group: '📷 Stock Photo', name: 'Getty Images', default_account_id: 'PAYONEER' },
    { id: 'INC_DEPOSIT', type: 'income', group: '📷 Stock Photo', name: 'Depositphotos', default_account_id: 'PAYONEER' },
    { id: 'INC_DREAMSTIME', type: 'income', group: '📷 Stock Photo', name: 'Dreamstime', default_account_id: 'PAYONEER' },
    { id: 'INC_CANVA', type: 'income', group: '📷 Stock Photo', name: 'Canva' },
    { id: 'INC_STOCK_OTHER', type: 'income', group: '📷 Stock Photo', name: 'เว็บอื่น ๆ' },
    { id: 'INC_YOUTUBE', type: 'income', group: '▶️ YouTube', name: 'YouTube AdSense' },
    { id: 'INC_FACEBOOK', type: 'income', group: '📘 Facebook', name: 'รายได้เพจ Facebook' },
    { id: 'INC_TIKTOK_AFF', type: 'income', group: '🛒 Affiliate', name: 'TikTok นายหน้า' },
    { id: 'INC_SEED', type: 'income', group: '📚 หนังสือ', name: 'ค่าลิขสิทธิ์หนังสือ' },
    { id: 'INC_COURSE', type: 'income', group: '🎓 คอร์ส', name: 'คอร์สออนไลน์', default_account_id: 'KB1' },
    { id: 'INC_RENT', type: 'income', group: '🏘️ ค่าเช่า', name: 'ค่าเช่าบ้าน', default_account_id: 'KB1', default_asset_id: 'H_RENT' },
    { id: 'INC_DIVIDEND', type: 'income', group: '📈 ลงทุน', name: 'ปันผลหุ้น', tax_tag: 'dividend' },
    { id: 'INC_INTEREST', type: 'income', group: '📈 ลงทุน', name: 'ดอกเบี้ยรับ' },
    { id: 'INC_FAMILY', type: 'income', group: '👩 ครอบครัว', name: 'รับจากครอบครัว' },
    { id: 'INC_OTHER', type: 'income', group: '💰 อื่น ๆ', name: 'รายรับอื่น ๆ' },
    { id: 'INC_UNKNOWN', type: 'income', group: '❓ รอตรวจ', name: 'จำไม่ได้' },

    // ---------- รายจ่าย ----------
    { id: 'EXP_HOME_LOAN', type: 'expense', group: '🏠 บ้าน', name: 'ผ่อนบ้าน' },
    { id: 'EXP_HOME_WATER', type: 'expense', group: '🏠 บ้าน', name: 'ค่าน้ำ', default_asset_id: 'H_MAIN' },
    { id: 'EXP_HOME_ELEC', type: 'expense', group: '🏠 บ้าน', name: 'ค่าไฟ', default_asset_id: 'H_MAIN' },
    { id: 'EXP_HOME_NET', type: 'expense', group: '🏠 บ้าน', name: 'อินเทอร์เน็ต' },
    { id: 'EXP_HOME_REPAIR', type: 'expense', group: '🏠 บ้าน', name: 'ซ่อมแซม/ของใช้ในบ้าน' },
    { id: 'EXP_PHONE', type: 'expense', group: '📱 สื่อสาร', name: 'ค่ามือถือ' },
    { id: 'EXP_CAR_LOAN', type: 'expense', group: '🚗 รถ', name: 'ผ่อนรถ' },
    { id: 'EXP_CAR_INS', type: 'expense', group: '🚗 รถ', name: 'ประกันรถ' },
    { id: 'EXP_CAR_FUEL', type: 'expense', group: '🚗 รถ', name: 'น้ำมัน' },
    { id: 'EXP_CAR_SERVICE', type: 'expense', group: '🚗 รถ', name: 'ซ่อมบำรุง' },
    { id: 'EXP_CAR_TOLL', type: 'expense', group: '🚗 รถ', name: 'ทางด่วน/ที่จอด' },
    { id: 'EXP_CAR_TAX', type: 'expense', group: '🚗 รถ', name: 'ภาษีรถ/พ.ร.บ.' },
    { id: 'EXP_SSO_SELF', type: 'expense', group: '🛡️ ประกัน', name: 'ประกันสังคม (ตัวเอง)', tax_tag: 'deduct_sso' },
    { id: 'EXP_INS_LIFE', type: 'expense', group: '🛡️ ประกัน', name: 'ประกันชีวิต/สุขภาพ', tax_tag: 'deduct_insurance' },
    { id: 'EXP_FOOD', type: 'expense', group: '☕ กิน/จิปาถะ', name: 'อาหาร' },
    { id: 'EXP_COFFEE', type: 'expense', group: '☕ กิน/จิปาถะ', name: 'กาแฟ/เครื่องดื่ม' },
    { id: 'EXP_SNACK', type: 'expense', group: '☕ กิน/จิปาถะ', name: 'ขนม' },
    { id: 'EXP_MISC', type: 'expense', group: '☕ กิน/จิปาถะ', name: 'จิปาถะ/ของใช้' },
    { id: 'EXP_GF', type: 'expense', group: '❤️ คนรัก', name: 'ค่าใช้จ่ายให้คนรัก' },
    { id: 'EXP_FAMILY', type: 'expense', group: '👩 ครอบครัว', name: 'ให้ครอบครัว' },
    { id: 'EXP_SHOPEE', type: 'expense', group: '🛍️ ช้อปออนไลน์', name: 'Shopee' },
    { id: 'EXP_TIKTOKSHOP', type: 'expense', group: '🛍️ ช้อปออนไลน์', name: 'TikTok Shop' },
    { id: 'EXP_SHOP_OTHER', type: 'expense', group: '🛍️ ช้อปออนไลน์', name: 'ร้านค้าอื่น ๆ' },
    { id: 'EXP_INTEREST', type: 'expense', group: '💳 การเงิน', name: 'ดอกเบี้ยจ่าย' },
    { id: 'EXP_FEE', type: 'expense', group: '💳 การเงิน', name: 'ค่าธรรมเนียม' },
    { id: 'EXP_FX', type: 'expense', group: '💳 การเงิน', name: 'ส่วนต่างค่าเงิน' },
    { id: 'EXP_BIZ_SOFTWARE', type: 'expense', group: '💼 ต้นทุนธุรกิจ', name: 'โปรแกรม/สมาชิก', tax_tag: 'biz_cost' },
    { id: 'EXP_BIZ_ADS', type: 'expense', group: '💼 ต้นทุนธุรกิจ', name: 'ค่าโฆษณา', tax_tag: 'biz_cost' },
    { id: 'EXP_BIZ_EQUIP', type: 'expense', group: '💼 ต้นทุนธุรกิจ', name: 'อุปกรณ์', tax_tag: 'biz_cost' },
    { id: 'EXP_BIZ_OTHER', type: 'expense', group: '💼 ต้นทุนธุรกิจ', name: 'ต้นทุนอื่น ๆ', tax_tag: 'biz_cost' },
    { id: 'EXP_HEALTH', type: 'expense', group: '🌿 ทั่วไป', name: 'สุขภาพ/ยา' },
    { id: 'EXP_TRAVEL', type: 'expense', group: '🌿 ทั่วไป', name: 'เดินทาง/ท่องเที่ยว' },
    { id: 'EXP_FUN', type: 'expense', group: '🌿 ทั่วไป', name: 'บันเทิง' },
    { id: 'EXP_OTHER', type: 'expense', group: '🌿 ทั่วไป', name: 'อื่น ๆ' },
    { id: 'EXP_UNKNOWN', type: 'expense', group: '❓ รอตรวจ', name: 'จำไม่ได้' }
  ],

  // ปุ่มลัดหน้าแรก — กดแล้วเปิดฟอร์มที่กรอกไว้ให้แล้ว เหลือใส่ยอด
  favorites: [
    { id: 'F_COFFEE', label: 'กาแฟ', icon: '☕', type: 'expense', category_id: 'EXP_COFFEE', account_id: 'KB1' },
    { id: 'F_FOOD', label: 'ข้าว', icon: '🍜', type: 'expense', category_id: 'EXP_FOOD', account_id: 'KB1' },
    { id: 'F_SNACK', label: 'ขนม', icon: '🍪', type: 'expense', category_id: 'EXP_SNACK', account_id: 'KB1' },
    { id: 'F_MISC', label: 'จิปาถะ', icon: '🛒', type: 'expense', category_id: 'EXP_MISC', account_id: 'KB1' },
    { id: 'F_FUEL', label: 'น้ำมัน', icon: '⛽', type: 'expense', category_id: 'EXP_CAR_FUEL', account_id: 'KB1' },
    { id: 'F_SHOPEE', label: 'Shopee', icon: '🛍️', type: 'expense', category_id: 'EXP_SHOPEE', account_id: 'KB1' },
    { id: 'F_HOME', label: 'ผ่อนบ้าน', icon: '🏠', type: 'expense', category_id: 'EXP_HOME_LOAN', account_id: 'KB1', asset_id: 'H_MAIN' },
    { id: 'F_RENT', label: 'ค่าเช่าเข้า', icon: '💰', type: 'income', category_id: 'INC_RENT', account_id: 'KB1', asset_id: 'H_RENT' },
    { id: 'F_CAR', label: 'ผ่อนรถ', icon: '🚗', type: 'expense', category_id: 'EXP_CAR_LOAN', account_id: 'KB1', asset_id: 'CAR_1' },
    { id: 'F_CC', label: 'จ่ายบัตรเครดิต', icon: '💳', type: 'transfer', account_id: 'KB1', to_account_id: 'CC_UOB' },
    { id: 'F_TMN', label: 'เติม TrueMoney', icon: '🟧', type: 'transfer', account_id: 'KB1', to_account_id: 'TMN' }
  ],

  /*
   * กฎจัดหมวดตอนนำเข้า Statement — pattern คั่นหลายคำด้วย | (ไม่สนตัวพิมพ์เล็ก/ใหญ่)
   * ตรงกับคำใน "รายละเอียด" ข้อไหนก่อนใช้ข้อนั้น (กฎที่ระบบจำจากการแก้ของคุณจะอยู่บนสุด)
   * type: expense | income | transfer — ถ้าเป็น transfer ใส่ other_account_id = บัญชีอีกฝั่ง
   * กฎเฉพาะตัว (เช่น รหัสหักบัญชีผ่อนบ้านของธนาคาร) ให้เพิ่มในชีต Rules ไม่ต้องใส่ที่นี่
   */
  rules: [
    { id: 'R_TMN', pattern: 'TrueMoney|ทรูมันนี่', type: 'transfer', other_account_id: 'TMN' },
    { id: 'R_SPL', pattern: 'SPayLater|ShopeePay Later', type: 'transfer', other_account_id: 'SPAYLATER' },
    { id: 'R_CARLOAN', pattern: 'Leasing|ลีสซิ่ง|TISCO|ทิสโก้|Krungsri Auto|กรุงศรี ออโต้', type: 'expense', category_id: 'EXP_CAR_LOAN' },
    { id: 'R_SSO', pattern: 'ประกันสังคม|Social Security', type: 'expense', category_id: 'EXP_SSO_SELF' },
    { id: 'R_ELEC', pattern: 'การไฟฟ้า|PEA|MEA', type: 'expense', category_id: 'EXP_HOME_ELEC' },
    { id: 'R_WATER', pattern: 'การประปา|ประปา|MWA|PWA', type: 'expense', category_id: 'EXP_HOME_WATER' },
    { id: 'R_NET', pattern: '3BB|AIS Fibre|True Online|ทรูออนไลน์|NT Broadband', type: 'expense', category_id: 'EXP_HOME_NET' },
    { id: 'R_PHONE', pattern: 'AIS|dtac|TrueMove|ทรูมูฟ|แอดวานซ์ อินโฟร์', type: 'expense', category_id: 'EXP_PHONE' },
    { id: 'R_FUEL', pattern: 'ปิโตรเลียม|ปตท|PTT|บางจาก|Bangchak|Shell|เชลล์|Caltex|คาลเท็กซ์|PT Station|พีทีจี', type: 'expense', category_id: 'EXP_CAR_FUEL' },
    { id: 'R_SHOPEE', pattern: 'Shopee|ช้อปปี้', type: 'expense', category_id: 'EXP_SHOPEE' },
    { id: 'R_TIKTOK', pattern: 'TikTok|ติ๊กต็อก', type: 'expense', category_id: 'EXP_TIKTOKSHOP' },
    { id: 'R_COFFEE', pattern: 'Cafe|Café|Coffee|กาแฟ|คาเฟ่|Amazon|Starbucks|Inthanin|อินทนิล', type: 'expense', category_id: 'EXP_COFFEE' },
    { id: 'R_SNACK', pattern: 'เบเกอรี่|Bakery|ขนม|ไอศกรีม|Swensen', type: 'expense', category_id: 'EXP_SNACK' },
    { id: 'R_FOOD', pattern: 'ร้านอาหาร|อาหาร|ข้าว|ก๋วยเตี๋ยว|ฟู้ด|Food|KFC|McDonald|แมคโดนัลด์|MK |Grab|LINE MAN|ไลน์แมน|robinhood', type: 'expense', category_id: 'EXP_FOOD' },
    { id: 'R_MISC', pattern: 'ซีพี ออลล์|เซเว่น|7-Eleven|7-11|โลตัส|Lotus|บิ๊กซี|Big C|แม็คโคร|Makro|Tops|ท็อปส์|วัตสัน|Watsons|Boots', type: 'expense', category_id: 'EXP_MISC' },
    { id: 'R_FEE', pattern: 'ค่าธรรมเนียม|RTGS Fee', type: 'expense', category_id: 'EXP_FEE' },
    { id: 'R_DIVIDEND', pattern: 'เงินปันผล|ปันผล|Dividend', type: 'income', category_id: 'INC_DIVIDEND' },
    { id: 'R_INTEREST', pattern: 'ดอกเบี้ย|Interest', type: 'income', category_id: 'INC_INTEREST' },
    { id: 'R_INC_CANVA', pattern: 'CANVA', type: 'income', category_id: 'INC_CANVA' },
    { id: 'R_INC_SS', pattern: 'Shutterstock', type: 'income', category_id: 'INC_SHUTTERSTOCK' },
    { id: 'R_INC_GETTY', pattern: 'Getty', type: 'income', category_id: 'INC_GETTY' },
    { id: 'R_INC_DREAM', pattern: 'Dreamstime', type: 'income', category_id: 'INC_DREAMSTIME' },
    { id: 'R_INC_DEPOSIT', pattern: 'Depositphotos', type: 'income', category_id: 'INC_DEPOSIT' },
    { id: 'R_INC_YT', pattern: 'Google Asia|AdSense|YouTube', type: 'income', category_id: 'INC_YOUTUBE' },
    { id: 'R_UOB_CASHPLUS', pattern: 'CASH PLUS', type: 'transfer', other_account_id: 'LOAN_UOB' },
    { id: 'R_UOB_CARD', pattern: 'MASTER CARD|TMRW CARD|CREDIT CARD', type: 'transfer', other_account_id: 'CC_UOB' },
    { id: 'R_FUND_REDEEM', pattern: 'กองทุนรวม', type: 'income', category_id: 'INC_OTHER' },
    { id: 'R_ATM_CASH', pattern: 'CASH W/D', type: 'transfer', other_account_id: 'CASH' },
    { id: 'R_ADOBE', pattern: 'Adobe', type: 'expense', category_id: 'EXP_BIZ_SOFTWARE' },
    { id: 'R_META', pattern: 'Facebook|Meta Platforms|FACEBK', type: 'expense', category_id: 'EXP_BIZ_ADS' }
  ],

  // owner_names: ชื่อเจ้าของบัญชี (ไทย/อังกฤษ คั่นด้วย ,) ใช้แยก "โอนเข้าบัญชีตัวเอง" ออกจากรายรับ-รายจ่าย
  settings: { usd_thb: 33, owner_names: '' }
};
