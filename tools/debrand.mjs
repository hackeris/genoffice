#!/usr/bin/env node
/**
 * debrand.mjs —— 品牌替换（去上游化 B2 批次）
 *
 * 用法：
 *   node tools/debrand.mjs           # dry-run：只报告命中，不动文件
 *   node tools/debrand.mjs --write   # 实际写入
 *
 * 边界（重要）：
 *   - 只处理**用户可见的活文案**。描述已移除功能（账号/积分/集成页）的死码由 B1 批次删除，
 *     不在这里换词——换成新品牌等于给不存在的功能做广告。
 *   - 不碰内部标识：`@genoffice/*` 包名、`GENOFFICE_*` 环境变量、`* GO` 字体族名。
 *   - 不碰构建产物（out/ dist/ node_modules/）——重跑即重建。
 *
 * 加新规则时：先跑 dry-run 看命中面，确认没误伤再写进去。
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const WRITE = process.argv.includes('--write')

const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', 'build', '.git', 'coverage'])
const EXT = /\.(ts|tsx|html|css|json|cjs|mjs)$/

// ── 规则表 ─────────────────────────────────────────────────────────────
// `files` 限定规则生效的文件；`pattern` 必须带 g 标志（幂等：替换后不再匹配）。
const RULES = [
  // ── AI 面板：Genspark → AI（产品不引入第二个 AI 品牌）───────────────
  {
    id: 'ribbon-ai-name',
    desc: 'Ribbon 上的 AI 助手名 Genspark → AI',
    files: /^apps\/(docs|pdf|slides)\/src\/renderer\/i18n\/(ribbon\/)?[A-Za-z-]+\.ts$/,
    pattern: /(ribbonAiAssistant:\s*)'Genspark'/g,
    replace: "$1'AI'",
  },
  {
    id: 'ai-panel-title',
    desc: 'AI 面板标题 Genspark → AI',
    files: /^apps\/(docs|slides)\/src\/renderer\/i18n\/ai\/[A-Za-z-]+\.ts$/,
    pattern: /(aiPanelTitle:\s*)'Genspark'/g,
    replace: "$1'AI'",
  },

  // ── 产品名：GenOffice → Sota Office（用户可见的活文案）──────────────
  // 先匹配冒号后的引号，再用 [^']* 吃掉语序不同的部分——否则
  // 'Aide GenOffice Docs' 这种 GenOffice 不在值开头的会漏掉。
  {
    id: 'menu-help-label',
    desc: '应用菜单的帮助标签',
    files: /^apps\/[a-z]+\/src\/main\/.*\.ts$/,
    pattern: /(menu[A-Za-z]*Help:\s*'[^']*)GenOffice/g,
    replace: '$1Sota Office',
  },
  {
    id: 'window-title',
    desc: '窗口标题',
    files: /^apps\/[a-z]+\/src\/main\/.*\.ts$/,
    pattern: /(title:\s*')GenOffice/g,
    replace: '$1Sota Office',
  },
  {
    id: 'untitled-doc-name',
    desc: '未命名标签页的默认名',
    files: /^apps\/shell\/src\/main\/tab-manager\.ts$/,
    pattern: /'GenOffice Docs'/g,
    replace: "'Sota Office Docs'",
  },
  {
    id: 'onboarding-welcome',
    desc: '首次启动的欢迎语',
    files: /^apps\/shell\/src\/renderer\/src\/strings\.ts$/,
    pattern: /(onbTitle1:\s*'[^']*)GenOffice/g,
    replace: '$1Sota Office',
  },
  {
    id: 'shell-error-msg',
    desc: 'Shell 的就绪前错误提示',
    files: /^apps\/shell\/src\/main\/index\.ts$/,
    pattern: /GenOffice is not ready/g,
    replace: 'Sota Office is not ready',
  },

  // ── MCP：标识符用紧凑形式，人读的文字用带空格形式 ───────────────────
  {
    id: 'mcp-identity',
    desc: 'MCP server 与工具名（标识符）',
    files: /^apps\/shell\/src\/main\/mcp\/.*\.ts$/,
    pattern: /((?:name|server):\s*')GenOffice'/g,
    replace: "$1SotaOffice'",
  },
  {
    id: 'mcp-prose',
    desc: 'MCP 工具的描述与回执文字',
    files: /^apps\/shell\/src\/main\/mcp\/.*\.ts$/,
    pattern: /(in the running |is open in )GenOffice/g,
    replace: '$1Sota Office',
  },

  // ── 对外标识：AI 请求的 UA 与 Codex 客户端身份 ─────────────────────
  {
    id: 'ai-user-agent',
    desc: 'AI 请求的 User-Agent',
    files: /^packages\/ai-provider\/src\/fetch\.ts$/,
    pattern: /(AI_DEFAULT_USER_AGENT = ')GenOffice'/g,
    replace: "$1SotaOffice'",
  },
  {
    id: 'codex-identity',
    desc: 'Codex CLI 的提示词与客户端标识',
    files: /^packages\/ai-provider\/src\/codex-app-server\.ts$/,
    pattern: /GenOffice/g,
    replace: 'Sota Office',
  },
  {
    id: 'codex-client-name',
    desc: 'Codex 客户端协议名（小写标识符）',
    files: /^packages\/ai-provider\/src\/codex-app-server\.ts$/,
    pattern: /(clientInfo: \{ name: ')genoffice'/g,
    replace: "$1sotaoffice'",
  },

  // ── 死键：整条删掉，不是换词 ────────────────────────────────────────
  // 这些 key 描述的功能已随账号链移除（登录/积分/云项目/账号设置），UI 入口不存在了，
  // 且经确认无任何消费点。换成新品牌等于给不存在的功能做广告，所以删。
  // 值可能跨行（`key:\n  '文本',`），pattern 里用 (?:\n[ \t]*)? 吃掉换行。
  {
    id: 'dead-i18n-keys',
    desc: '死键：账号/登录/积分/云项目（无消费点）',
    files: /(^|\/)i18n\/.*\.ts$|renderer\/src\/strings\.ts$/,
    pattern: /^[ \t]*(?:aiGskLoginBtn|appSettingsLogin|appSettingsAccount|appSettingsLoggedOut|appNotLoggedIn|appLoginGenspark|appGensparkAccount|aiNotLoggedIn|aiLoginGenspark|aiGensparkAccount|accountGenspark|loginGenspark|loggedInGenspark|navCloud|cloudLoginHint|cloudSubtitle|loginNetworkError|setAiGensparkHint|setAiMediaGensparkHint):[ \t]*(?:\n[ \t]*)?(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")[ \t]*,[ \t]*\r?\n/gm,
    replace: '',
  },

  // 第二批死键：gsk 工具设置项、积分错误、未登录错误。含内嵌在 main 文件里的字典。
  {
    id: 'dead-i18n-keys-2',
    desc: '死键：gsk 工具设置项 / 积分错误 / 未登录错误（无消费点）',
    files: /(^|\/)i18n\/.*\.ts$|renderer\/src\/strings\.ts$|src\/main\/(docs-main|sheets-main|i18n-main)\.ts$/,
    pattern: /^[ \t]*(?:setAiGskTools|setAiGskToolsDesc|aiCreditsExhausted|errGskNotLoggedIn):[ \t]*(?:\n[ \t]*)?(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")[ \t]*,[ \t]*\r?\n/gm,
    replace: '',
  },

  // 第三批死键：Onboarding 的社区页与 Star 提示（UI 已在上游化改造中移除）
  {
    id: 'dead-i18n-promo',
    desc: '死键：Onboarding 社区页 / Star 提示（UI 已移除）',
    files: /(^|\/)i18n\/.*\.ts$|renderer\/src\/strings\.ts$/,
    pattern: /^[ \t]*(?:onbTitle2|onbBody2|onbCredits|onbJoinGenTeam|onbNote3|onbStarHint|starOnGitHub):[ \t]*(?:\n[ \t]*)?(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")[ \t]*,[ \t]*\r?\n/gm,
    replace: '',
  },

  // 给 AI 读的工具描述：里面把 Genspark 当成一个在世的 provider 在说事。
  // 这些文字会被模型转述给用户，所以也算露出。
  {
    id: 'ai-tool-desc-genspark',
    desc: 'AI 工具描述里的 Genspark（provider 已移除）',
    files: /-skill\.ts$|media-protocols\.ts$|desktop-api\.ts$|shared\/ipc\.ts$|preload\/index\.ts$/,
    pairs: [
      [
        'defaults to the configured model. Genspark only — specify',
        'defaults to the configured model. Specify',
      ],
      [
        '(video and audio need Genspark or Gemini as the media provider)',
        '(video and audio need a media provider that supports them, e.g. Gemini)',
      ],
      [
        '(no image/media provider: signed out of Genspark or cloud tools off, and no media API key in Settings)',
        '(no image/media provider configured: add a media API key in Settings)',
      ],
      [
        '(no image provider: signed out of Genspark or cloud tools off, and no media API key in Settings)',
        '(no image provider configured: add a media API key in Settings)',
      ],
      ['analysis needs Gemini or Genspark.', 'analysis needs a capable media provider (e.g. Gemini).'],
      ['Invalid Genspark account status response.', 'Invalid account status response.'],
    ],
  },

  // 运行时路径与文件名：这些用户能在文件管理器里直接看到，算露出。
  // 临时目录（tmpdir 下的 genoffice-*）不算——用户不会翻到那里，保留。
  {
    id: 'runtime-paths-brand',
    desc: '运行时路径与文件名（用户可见）',
    // 不限定 src/main：default-save-dir.ts 在 packages/electron-utils/src/ 直下，
    // 首轮因 files 只认 src/main 而漏掉（真机侧栏出现 GenOffice 文件夹的根因）
    files: /src\/(main\/)?.*\.ts$/,
    pairs: [
      [
        "join(app.getPath('documents'), 'GenOffice')",
        "join(app.getPath('documents'), 'Sota Office')",
      ],
      ["'GenOffice Dev'", "'Sota Office Dev'"],
      ['.genoffice-assets.json', '.sotaoffice-assets.json'],
      ['.genoffice-markdown-conversion.json', '.sotaoffice-markdown-conversion.json'],
      ['.genoffice-replaced-', '.sotaoffice-replaced-'],
      ["join(homedir(), '.genoffice')", "join(homedir(), '.sotaoffice')"],
      ['GenOffice cannot open', 'Sota Office cannot open'],
      ['GenOffice does not have', 'Sota Office does not have'],
      ['genoffice-ski', 'sotaoffice-ski'],
    ],
  },

  // package.json 的元信息：productName 决定 Electron 的 app.name（窗口标题、userData 路径、
  // About 框），author 出现在 About 里，appId 是桌面端的安装标识。都是用户可见的。
  // 注意 "productName": "GenOffice" 带引号，不会误吃 "GenOffice Slides" 那一行。
  {
    id: 'pkg-identity',
    desc: '各 app 的 package.json 元信息（productName / author / appId）',
    files: /^apps\/[a-z]+\/package\.json$/,
    pairs: [
      ['"productName": "GenOffice Docs"', '"productName": "Sota Office Docs"'],
      ['"productName": "GenOffice HTML"', '"productName": "Sota Office HTML"'],
      ['"productName": "GenOffice Markdown"', '"productName": "Sota Office Markdown"'],
      ['"productName": "GenOffice PDF"', '"productName": "Sota Office PDF"'],
      ['"productName": "GenOffice Sheets"', '"productName": "Sota Office Sheets"'],
      ['"productName": "GenOffice Slides"', '"productName": "Sota Office Slides"'],
      ['"productName": "GenOffice"', '"productName": "Sota Office"'],
      ['"author": "GenOffice"', '"author": "Sota Office"'],
      ['"appId": "com.genoffice.docs"', '"appId": "app.fuqidian.sotaoffice.docs"'],
      ['"appId": "com.genoffice.slides"', '"appId": "app.fuqidian.sotaoffice.slides"'],
      ['"description": "Unified GenOffice shell', '"description": "Unified Sota Office shell'],
    ],
  },

  // AI 的 system prompt：模型自称 "GenOffice Xxx"，会转述给用户
  {
    id: 'ai-system-prompt-brand',
    desc: 'AI system prompt 里的产品自称（模型会转述）',
    files: /-skill\.ts$|-writer\.ts$/,
    pairs: [
      ['inside GenOffice HTML', 'inside Sota Office HTML'],
      ['writer of GenOffice Markdown', 'writer of Sota Office Markdown'],
      ['brief writer of GenOffice HTML', 'brief writer of Sota Office HTML'],
      ['GenOffice Docs', 'Sota Office Docs'],
    ],
  },

  // CLI 的帮助文本：产品名换词 + 去掉已移除的 genspark provider。
  // CLI 没进 HAP（鸿蒙侧不含它），但桌面端用户会看到这些 help。
  {
    id: 'cli-help-brand',
    desc: 'CLI 帮助文本里的品牌（产品名 + 已移除的 genspark）',
    files: /packages\/cli\/src\/commands\/.*\.ts$/,
    pairs: [
      [" 4k (Genspark only)'", " 4k'"],
      ["'Genspark model override (e.g. fal-bria-rmbg)'", "'Model override (e.g. fal-bria-rmbg)'"],
      [
        'through the provider configured in GenOffice (Genspark, Serper, Tavily).',
        'through the provider configured in Sota Office (Serper, Tavily, Bocha).',
      ],
    ],
  },

  // Ribbon 上的 "Genspark AI"：六个 app 各一处按钮文字 + 分组标签，用户直接可见。
  // 注释里的同名文本（{/* ---- Genspark AI (first slot...) ---- */}）不匹配，保留。
  {
    id: 'ribbon-genspark-ai-label',
    desc: 'Ribbon 按钮与分组标签上的 "Genspark AI"（6 个 app）',
    files: /src\/renderer\/.*\.tsx$/,
    pairs: [
      ['<span>Genspark AI</span>', '<span>AI</span>'],
      ['<strong>Genspark AI</strong>', '<strong>AI</strong>'],
      [
        '<div className="ribbon-group-label">Genspark AI</div>',
        '<div className="ribbon-group-label">AI</div>',
      ],
      ['<Group label="Genspark AI">', '<Group label="AI">'],
    ],
  },

  // slides 的 AI 未配置错误：文案还是"gsk 未登录，去跑 gsk login"——账号链和 gsk 都没了，
  // 现在该说的是"去设置里配一个 provider"。key 名（errAiProviderUnset）是对的，改值。
  {
    id: 'err-ai-provider-unset',
    desc: 'AI 未配置的错误文案（gsk 登录 → 配置 provider），20 语言',
    files: /src\/main\/i18n-main\.ts$/,
    pairs: [
      [
        'gsk 未登录:请先运行 gsk login 登录 Genspark 账号',
        '未配置 AI 模型服务:请到设置里选择厂商并填入 API key',
      ],
      [
        'gsk not signed in: run gsk login to sign in to your Genspark account first',
        'No AI provider configured: choose one and enter its API key in Settings',
      ],
      [
        'gsk が未サインインです。先に gsk login を実行して Genspark アカウントにサインインしてください',
        'AI モデルサービスが未設定です。設定でプロバイダーを選び、API キーを入力してください',
      ],
      [
        'gsk가 로그인되어 있지 않습니다. 먼저 gsk login을 실행해 Genspark 계정에 로그인하세요',
        'AI 모델 서비스가 설정되지 않았습니다. 설정에서 공급자를 선택하고 API 키를 입력하세요',
      ],
      [
        "gsk non connecté : exécutez d'abord gsk login pour vous connecter à votre compte Genspark",
        "Aucun fournisseur d'IA configuré : choisissez-en un et saisissez sa clé API dans les réglages",
      ],
      [
        'gsk nicht angemeldet: Führen Sie zuerst gsk login aus, um sich bei Ihrem Genspark-Konto anzumelden',
        'Kein KI-Anbieter konfiguriert: Wählen Sie einen in den Einstellungen und geben Sie dessen API-Schlüssel ein',
      ],
      [
        'gsk sin sesión iniciada: ejecuta primero gsk login para iniciar sesión en tu cuenta de Genspark',
        'No hay proveedor de IA configurado: elige uno e introduce su clave API en los ajustes',
      ],
      [
        'gsk ยังไม่ได้เข้าสู่ระบบ: โปรดรัน gsk login เพื่อเข้าสู่ระบบบัญชี Genspark ก่อน',
        'ยังไม่ได้ตั้งค่าผู้ให้บริการ AI: ไปที่การตั้งค่าเพื่อเลือกและกรอก API key',
      ],
      [
        'gsk belum masuk: jalankan gsk login dulu untuk masuk ke akun Genspark',
        'Penyedia AI belum dikonfigurasi: pilih satu dan masukkan API key-nya di Pengaturan',
      ],
      [
        'gsk не авторизован: сначала выполните gsk login, чтобы войти в учётную запись Genspark',
        'Поставщик ИИ не настроен: выберите его в настройках и введите API-ключ',
      ],
      [
        'gsk غير مسجَّل الدخول: شغّل gsk login أولًا لتسجيل الدخول إلى حساب Genspark',
        'لم يتم تهيئة مزوّد الذكاء الاصطناعي: اختر مزوّدًا وأدخل مفتاح API في الإعدادات',
      ],
      [
        'gsk não conectado: execute gsk login primeiro para entrar na sua conta Genspark',
        'Nenhum provedor de IA configurado: escolha um e insira a chave de API nas configurações',
      ],
      [
        "gsk non ha effettuato l'accesso: esegui prima gsk login per accedere al tuo account Genspark",
        'Nessun provider di IA configurato: scegline uno e inserisci la chiave API nelle impostazioni',
      ],
      [
        'gsk nie jest zalogowany: najpierw uruchom gsk login, aby zalogować się na konto Genspark',
        'Nie skonfigurowano dostawcy AI: wybierz go w ustawieniach i wpisz klucz API',
      ],
      [
        'gsk není přihlášen: nejprve spusťte gsk login a přihlaste se k účtu Genspark',
        'Poskytovatel AI není nastaven: vyberte ho v nastavení a zadejte jeho API klíč',
      ],
      [
        'gsk is niet aangemeld: voer eerst gsk login uit om u aan te melden bij uw Genspark-account',
        'Geen AI-provider geconfigureerd: kies er een en voer de API-sleutel in bij Instellingen',
      ],
      [
        'gsk belum log masuk: jalankan gsk login dahulu untuk log masuk ke akaun Genspark anda',
        'Pembekal AI belum dikonfigurasikan: pilih satu dan masukkan API key dalam Tetapan',
      ],
      [
        'gsk אינו מחובר: הרץ תחילה gsk login כדי להיכנס לחשבון Genspark שלך',
        'לא הוגדר ספק AI: בחר ספק והזן את מפתח ה-API בהגדרות',
      ],
      [
        'gsk साइन इन नहीं है: पहले gsk login चलाकर अपने Genspark खाते में साइन इन करें',
        'AI प्रदाता कॉन्फ़िगर नहीं है: सेटिंग्स में प्रदाता चुनें और उसकी API key डालें',
      ],
      [
        'gsk 未登入:請先執行 gsk login 登入 Genspark 帳號',
        '未設定 AI 模型服務:請到設定裡選擇廠商並填入 API key',
      ],
    ],
  },

  // AI 面板标题是**硬编码**的（不走 i18n），所以改 aiPanelTitle 的短语覆盖不到它。
  // 图标是 AiMark（已换中性星芒），文字跟着叫 AI。
  {
    id: 'ai-panel-title-hardcoded',
    desc: 'AI 面板标题的硬编码文字（5 个 app，不走 i18n）',
    files: /src\/renderer\/(ai\/)?Ai(Chat)?Panel\.tsx$/,
    pairs: [
      ['aria-label="Genspark AI"', 'aria-label="AI"'],
      ['aria-label="Genspark"', 'aria-label="AI"'],
      ['\n          Genspark\n', '\n          AI\n'],
    ],
  },

  // AI 设置页的搜索来源说明：搜索 provider 已从 genspark 换成 bocha/custom，
  // 这句还在说"走 Genspark 登录"。20 种语言的措辞各不相同，逐句替换。
  {
    id: 'byok-note-search-source',
    desc: 'AI 设置说明的搜索来源（去掉已移除的 Genspark 登录）',
    files: /renderer\/src\/strings\.ts$/,
    pairs: [
      ['网页搜索仍走 Genspark 登录或免费来源。', '网页搜索走配置的搜索服务或免费来源。'],
      ['網頁搜尋仍走 Genspark 登入或免費來源。', '網頁搜尋走配置的搜尋服務或免費來源。'],
      [
        'web search still uses the Genspark sign-in or free sources.',
        'web search uses your configured provider or free sources.',
      ],
      [
        'Web 検索は引き続き Genspark のサインインまたは無料ソースを使用します。',
        'Web 検索は設定した検索プロバイダーまたは無料ソースを使用します。',
      ],
      [
        '웹 검색은 여전히 Genspark 로그인 또는 무료 소스를 사용합니다.',
        '웹 검색은 설정한 검색 공급자 또는 무료 소스를 사용합니다.',
      ],
      [
        'la recherche web utilise toujours la connexion Genspark ou des sources gratuites.',
        'la recherche web utilise votre fournisseur configuré ou des sources gratuites.',
      ],
      [
        'die Websuche nutzt weiterhin die Genspark-Anmeldung oder kostenlose Quellen.',
        'die Websuche nutzt Ihren konfigurierten Anbieter oder kostenlose Quellen.',
      ],
      [
        'la búsqueda web sigue usando el inicio de sesión de Genspark o fuentes gratuitas.',
        'la búsqueda web usa tu proveedor configurado o fuentes gratuitas.',
      ],
      [
        'ส่วนการค้นหาเว็บยังใช้การลงชื่อเข้าใช้ Genspark หรือแหล่งข้อมูลฟรี',
        'ส่วนการค้นหาเว็บใช้ผู้ให้บริการที่กำหนดค่าหรือแหล่งข้อมูลฟรี',
      ],
      [
        'pencarian web tetap memakai login Genspark atau sumber gratis.',
        'pencarian web memakai penyedia yang dikonfigurasi atau sumber gratis.',
      ],
      [
        'веб-поиск по-прежнему использует вход в Genspark или бесплатные источники.',
        'веб-поиск использует настроенный провайдер или бесплатные источники.',
      ],
      [
        'ولا يزال البحث في الويب يستخدم تسجيل دخول Genspark أو مصادر مجانية.',
        'ويستخدم البحث في الويب المزوّد المُهيأ أو مصادر مجانية.',
      ],
      [
        'a busca na web continua usando o login do Genspark ou fontes gratuitas.',
        'a busca na web usa o provedor configurado ou fontes gratuitas.',
      ],
      [
        "la ricerca web usa ancora l'accesso Genspark o fonti gratuite.",
        'la ricerca web usa il provider configurato o fonti gratuite.',
      ],
      [
        'wyszukiwanie w sieci nadal korzysta z logowania Genspark lub darmowych źródeł.',
        'wyszukiwanie w sieci korzysta ze skonfigurowanego dostawcy lub darmowych źródeł.',
      ],
      [
        'webové vyhledávání dál používá přihlášení ke Genspark nebo bezplatné zdroje.',
        'webové vyhledávání používá nakonfigurovaného poskytovatele nebo bezplatné zdroje.',
      ],
      [
        'zoeken op het web gebruikt nog steeds de Genspark-aanmelding of gratis bronnen.',
        'zoeken op het web gebruikt je geconfigureerde provider of gratis bronnen.',
      ],
      [
        'carian web masih menggunakan log masuk Genspark atau sumber percuma.',
        'carian web menggunakan pembekal yang dikonfigurasikan atau sumber percuma.',
      ],
      [
        'חיפוש באינטרנט עדיין משתמש בהתחברות Genspark או במקורות חינמיים.',
        'חיפוש באינטרנט משתמש בספק המוגדר או במקורות חינמיים.',
      ],
      [
        'वेब खोज अभी भी Genspark साइन-इन या मुफ़्त स्रोतों का उपयोग करती है।',
        'वेब खोज कॉन्फ़िगर किए गए प्रदाता या मुफ़्त स्रोतों का उपयोग करती है।',
      ],
    ],
  },

  // 搜索 provider 的说明键：genspark 分支已从 provider 列表移除，UI 无引用
  {
    id: 'dead-key-search-genspark',
    desc: '死键：genspark 搜索 provider 的说明（provider 已移除）',
    files: /renderer\/src\/strings\.ts$/,
    pattern: /^[ \t]*setAiSearchGensparkHint:[ \t]*(?:\n[ \t]*)?(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")[ \t]*,[ \t]*\r?\n/gm,
    replace: '',
  },

  // 传输层的积分错误映射：creditsErrorText 在 transport.ts 之外零消费点，
  // 且 BYOK 下不存在"平台积分"这回事——用户自己的 key 额度不足时显示上游充值链接是错的。
  {
    id: 'drop-credits-error-mapping',
    desc: 'AI 传输层的积分错误映射（无消费点 + 语义已不成立）',
    files: /src\/renderer\/ai\/transport\.ts$/,
    pattern: /^[ \t]*creditsErrorText: \(\) => t\('aiCreditsExhausted'\),[ \t]*\r?\n/gm,
    replace: '',
  },

  // ── AI 面板的图标组件 ──────────────────────────────────────────────
  // 原图形是上游的商标（圆角方块 + 星芒），六个 app 各内联了一份同样的 path。
  // 换成中性的四角星芒——通用形状，不含任何上游商标。有自有品牌图后替换这个 path。
  {
    id: 'ai-mark-rename',
    desc: 'AI 图标组件与 CSS 类名去品牌',
    // 不限定 src/renderer/ —— tests/ 里的 vi.mock 也引用组件名，漏了就编译/测试失败
    files: /^apps\/[a-z]+\/.*\.(tsx|ts|css)$/,
    pattern: /GensparkMark/g,
    replace: 'AiMark',
  },
  {
    id: 'ai-mark-css-class',
    desc: 'AI 图标的 CSS 类名（tsx 的 className 与 css 选择器都要改，漏一边样式就断）',
    files: /^apps\/[a-z]+\/.*\.(tsx|css)$/,
    pattern: /genspark-(mark|badge)/g,
    replace: 'ai-$1',
  },
  {
    id: 'ai-mark-comment',
    desc: 'AI 图标组件的注释（描述的是已换掉的旧图形）',
    files: /^apps\/[a-z]+\/.*\.(tsx|css)$/,
    pattern: /Genspark brand (mark|logo)( \(rounded-square sparkle badge\))?/g,
    replace: 'AI assistant $1',
  },
  {
    id: 'ai-mark-viewbox',
    desc: 'AI 图标画布尺寸改为标准 24 网格',
    files: /^apps\/[a-z]+\/src\/renderer\/.*\.tsx$/,
    pattern: /viewBox="0 0 130 130\.025"/g,
    replace: 'viewBox="0 0 24 24"',
  },
  {
    id: 'ai-mark-glyph',
    desc: 'AI 图标图形换成中性星芒',
    files: /^apps\/[a-z]+\/src\/renderer\/.*\.tsx$/,
    pattern: /d="M105\.115 0H24\.6428[^"]*"/g,
    replace: 'd="M12 1Q13 11 23 12Q13 13 12 23Q11 13 1 12Q11 11 12 1Z"',
  },

  // ── PDF 模块的错误提示与导出元数据 ─────────────────────────────────
  {
    id: 'pdf-error-and-meta',
    desc: 'PDF 的错误提示与文档元数据',
    files: /^apps\/pdf\/src\/main\/(pdf-main|save-pdf)\.ts$/,
    pattern: /(requires the |T: ')GenOffice/g,
    replace: '$1Sota Office',
  },

  // ── 批注作者名：PDF 批注的 /T 字段和侧栏署名、xlsx 网关的 NOTE_AUTHOR。
  // 用户打开批注列表就能看到，算露出。CLI 的 NOTE_AUTHOR 同名但 CLI 暂不入包（M3），不在此列。
  {
    id: 'note-author',
    desc: 'PDF/xlsx 批注默认作者名（用户可见）',
    files: /^apps\/pdf\/src\/.*\.(ts|tsx)$/,
    pairs: [
      ["|| 'GenOffice'", "|| 'Sota Office'"],
      ["fromText('GenOffice')", "fromText('Sota Office')"],
      ["omitted → 'GenOffice'", "omitted → 'Sota Office'"],
    ],
  },
]

// ── 扫描 ───────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (EXT.test(name)) out.push(full)
  }
  return out
}

const files = [...walk(join(ROOT, 'apps')), ...walk(join(ROOT, 'packages'))]
const report = []
const touched = new Map() // path → 新内容

for (const full of files) {
  const rel = relative(ROOT, full).replaceAll('\\', '/')
  let content = readFileSync(full, 'utf8')
  let text = content
  const hits = []

  for (const rule of RULES) {
    if (!rule.files.test(rel)) continue
    // `pairs` = 逐语言的整句替换（措辞各语言不同，写不出统一正则）
    const steps = rule.pairs
      ? rule.pairs.map(([from, to]) => [
          new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          to,
        ])
      : [[rule.pattern, rule.replace]]
    for (const [re, to] of steps) {
      const before = text
      text = text.replace(re, to)
      if (text !== before) hits.push({ rule: rule.id, n: (before.match(re) ?? []).length })
    }
  }

  if (hits.length) {
    report.push({ rel, hits })
    if (WRITE) touched.set(full, text)
  }
}

// ── 报告 ───────────────────────────────────────────────────────────────
const byRule = new Map()
let total = 0
for (const { rel, hits } of report) {
  for (const { rule, n } of hits) {
    if (!byRule.has(rule)) byRule.set(rule, { files: [], n: 0 })
    const entry = byRule.get(rule)
    entry.files.push(rel)
    entry.n += n
    total += n
  }
}

for (const rule of RULES) {
  const entry = byRule.get(rule.id)
  console.log(`\n[${rule.id}] ${rule.desc}`)
  if (!entry) {
    console.log('  （零命中——规则可能已失效，检查一下）')
    continue
  }
  console.log(`  命中 ${entry.n} 处 / ${entry.files.length} 个文件`)
  const list = entry.files
  if (list.length <= 5) for (const f of list) console.log(`    ${f}`)
  else {
    const dirs = new Set(list.map((f) => f.replace(/\/[^/]+$/, '')))
    for (const d of dirs) console.log(`    ${d}/ (${list.filter((f) => f.startsWith(d)).length})`)
  }
}

console.log(`\n合计 ${total} 处 / ${report.length} 个文件`)
if (WRITE) {
  for (const [full, text] of touched) writeFileSync(full, text)
  console.log(`已写入 ${touched.size} 个文件`)
} else {
  console.log('（dry-run；确认无误后加 --write）')
}
