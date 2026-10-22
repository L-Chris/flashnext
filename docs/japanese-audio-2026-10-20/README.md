# 日语词卡 Gemini 音频

## 范围与使用

本次为日语牌组已有、释义已审核的 343 张词卡添加独立的背面 MP3。331 个尚未完成释义审核的候选词不自动创建卡片。原有 Web 播放器、背面播放顺序和每牌组自动播放设置直接生效，无需新增获取/上传入口。

用户随后指定改用 `gemini-3.8-flash-tts` 与 `gemini-3.1-flash-tts-preview`。首批已导入的 154 条 Flash-Lite 音频保留；新批次只选择缺少背面音频的 189 张卡片，优先 3.8 Flash，当该模型的每日配额耗尽时使用 3.1 Flash。每条音频记录实际使用的模型、请求格式及声音，不能把备用模型产物标成主模型。完整进度与最终数量以 `verification.json` 为准。

已全部完成：343/343 张卡片均有背面音频。新增 189 条中，142 条来自 3.8 Flash、47 条来自 3.1 Flash；全部逐词检查通过。343 个 MP3 共 3,134,667 字节。生产文件哈希、旧有 154 条媒体及关联、其他 17 张数据表和实际 Web 背面播放校验均通过。

不修改词条、卡片正反面文字、记忆参数、学习状态、到期时间或复习日志。已存在背面音频的卡片保留原附件，不被本批次覆盖。英语卡片不参与本流程。

## 生成与读音检查

- 通过用户指定的 `https://chat.rethinkos.com` 调用已有 Gemini AI Studio provider。凭据只从项目 `.env` 的 `LLM_API_KEY` 读取，不传给前端，不进入产物、命令行参数或日志。
- 请求选择为 `gemini/tts-lite`，固定真实版本 `gemini-3.8-flash-lite-tts`，固定声音 `Kore`。Bifrost 的原生透传不解析此别名，因此透传路径使用真实模型名。
- 新补齐批次显式配置 3.8 Flash 主模型和 3.1 Flash 备用模型，声音继续使用 `Kore`。3.8 保留逐词 `speech_metadata` 和原生 WAV；3.1 使用已实测的简短日语提示、旧版 `prebuiltVoiceConfig`，只对明确为单声道 24 kHz L16 的裸 PCM 添加一次 WAV 文件头。盲转写检查保持一致。3.1 的复杂多语言词典提示曾返回 400，简化提示后四词试跑通过；模型实际请求保存在来源证据中。
- 配额状态分别按模型保存，一个 TTS 模型耗尽后不阻断另一个 TTS 模型或读音识别模型。只有两个已授权 TTS 模型都耗尽时才等待最早恢复时刻，不改用其他模型。
- 使用 `/genai_passthrough/v1beta/models/gemini-3.8-flash-lite-tts:generateContent`，直接保存原生 WAV。避免当前 Bifrost 2.2.6 OpenAI speech 接口的重复 WAV 文件头和 MIME 问题，不改动 Bifrost 服务配置。
- 正文只提交已确认的假名。词面、词性、中文义项、拍数、朗读要求放在 `speech_metadata.style` 中，避免把指令念入录音。Kaikki 提供的、可精确匹配词面/读音/词性的东京音调标签作为辅助提示；存在多个标签或不能确定下降位置的中高型时不强行指定。
- 当前项目 TTS 配额为每分钟 10 次。共享限速器给请求留出间隔，429 按服务端提示退避。每组最多四词，词间要求长停顿；只在检测到精确数量的内部停顿时切分，保留头尾余量。边界不确定时回退单词生成，不猜测切点。
- 切分后的每个词单独盲转写，识别器看不到预期单词、假名或义项。先用 `gemini/lite`；不匹配时再用 `gemini/gemini-3.8-flash` 检查。只规范全角/半角、片假名/平假名及标点，不删除促音、拗音、重复拍或长音来凑匹配。
- 转写仍不匹配时重新生成。全部尝试失败的词标为 `needs_review`，不能导入。完整范围导入要求每个目标词都有通过检查、身份和文件 SHA-256 均匹配的产物。
- 原始 WAV 保留，最终文件用 ffmpeg 转为单声道 24 kHz、64 kbps MP3。生成器按词条身份、读音、义项、音调提示和模型/声音配置检查缓存；已通过且文件未变的结果直接复用。

转写检查不是人工审音，也不能证明东京音调符合某一教材。所有产物明确记录 `pitchAccentCertified: false`。遇到具体词的音调或发音问题，应保留证据后单独替换，不修改词条身份或学习状态。

## 产物与来源

批次目录（Git 忽略）：`server/scripts/data/japanese-audio-2026-10-20/`。

当前补齐批次：`server/scripts/data/japanese-audio-flash-2026-10-20/`；3.1 的四词试跑在 `japanese-audio-3.1-pilot-2026-10-20/`，仅验证而不覆盖已有媒体。

- `plan.json`：词条 ID、稳定词典键、假名、词性/释义快照、卡片 ID、音调提示、模型和声音配置及计划哈希。
- `results/<wordId>.json`：状态、指纹、生成时间、具体模型/声音/提示、音频 SHA-256、盲转写及重试证据。
- `audio/`：原始单词 WAV 和最终 MP3；`groups/` 保留分组原音、输入顺序及切分来源。
- `generation-summary.json`：生成/复用/待核查统计。
- `quota-wait.json` / `continuation.json`：每日配额恢复时刻和后台续跑状态；没有凭据。

生产文件沿用现有 `media_assets` 与 `card_media`，保存到 `server/data/media/`。完整来源及恢复日志额外持久化到 `server/data/audio-imports/`，包含原计划、每词检查证据、新建媒体 ID 与关联 ID。无需新数据库字段。备份和迁移必须同时保留数据库、媒体目录和来源日志；不能只复制 SQLite 文件。

## 执行

先创建计划或检查当前身份（不调用模型）：

```bash
python3 server/scripts/prepare-japanese-audio.py \
  --db server/data/flashnext.db --deck-id 10 \
  --output server/scripts/data/japanese-audio-2026-10-20 \
  --kaikki server/scripts/data/japanese-n5-2026-10-19/kaikki-ja-zh.jsonl
```

加 `--generate` 才调用模型。`--limit 20` 可验证首批；去掉 limit 后继续全量，已通过结果复用。默认两个工作线程，共享每模型请求节流。

```bash
python3 server/scripts/prepare-japanese-audio.py \
  --db server/data/flashnext.db --deck-id 10 \
  --output server/scripts/data/japanese-audio-2026-10-20 \
  --kaikki server/scripts/data/japanese-n5-2026-10-19/kaikki-ja-zh.jsonl \
  --generate --workers 2
```

导入默认预演：

```bash
python3 server/scripts/import-japanese-audio.py \
  --db server/data/flashnext.db \
  --batch server/scripts/data/japanese-audio-2026-10-20 \
  --media-dir server/data/media \
  --report server/scripts/data/japanese-audio-2026-10-20/import-dry-run.json
```

正式导入增加 `--apply --backup <新的备份路径>`。当前媒体目录归 Docker 用户所有，宿主机执行正式导入需有该目录写权限。不要把 API Key 放入 sudo 参数；导入阶段只使用已验证本地文件，不读取 API Key。

本次实际遇到 AI Studio 每日 100 次 TTS 请求限制：截至 2026-10-20 中午，154 个词已通过检查，189 个待继续。首批显式使用 `--ready-only` 选择已通过的文件，仍对所选文件逐一验证；不加此参数的完整导入必须有全部目标产物。生产备份为 `server/data-backup/flashnext-pre-japanese-audio-20261020.db`。

后续核对：请求始终经过上述 Bifrost 域名，并非脚本直连 Google。Gemini provider 仅有一把启用的 Key `gemini-cloud`，生成日志确认选用了它。100/天来自 Google 返回的 `generate_requests_per_model_per_day`，不能据此判定项目处于免费层级；付费项目仍按模型、项目及层级应用配额。实际计费层级及页面 RPD 需在对应项目的 AI Studio 中核对，不能从 Bifrost 的本地价格估算得出。

已实测 `/genai/v1beta/models/gemini/tts-lite:generateContent`、不带 provider 的别名及真实模型名：均命中同一实际模型并收到相同的上游每日配额错误，别名解析有效，但配额耗尽时无法验证成功音频。核对已安装版本 2.2.6 的官方源码后，`/genai` 的 speech 转换会拼接 text，丢失逐词 `speech_metadata`，只处理旧版 prebuilt voice 字段，因此本批 TTS 保留原生透传。原生透传本身仍由 Bifrost 选择 provider Key 并记录日志。测试与脱敏结果在忽略目录 `server/scripts/data/bifrost-genai-audit-2026-10-20/`；未更改模型、计费或 provider 配置。

服务端返回的配额恢复时刻约为北京时间 15:00，已启动一次性的 systemd 后台任务 `flashnext-japanese-audio-20261020.service`，留出一分钟余量，约 15:01 开始续跑。任务由 `resume-japanese-audio.py` 执行，复用已通过结果；全部目标通过后才运行完整导入，跳过首批已有附件，并执行生产文件、数据库及浏览器检查。任务不会调整计费、provider 或模型配置，也不会创建 331 个候选词的卡片。当前状态以 `continuation.json` 和本地批次目录中的 `verification.json` 为准；如词条身份变动、仍有读音失败或核对异常，任务停止并记录 `needs_review`。

上述 Lite 等待任务已按用户要求停止，其状态为 `superseded`。替代任务为 `flashnext-japanese-audio-flash-20261020.service`，当前立即使用新的两个模型补齐，无需等待 Lite 配额。新批次的手动生成命令：

```bash
python3 server/scripts/prepare-japanese-audio.py \
  --db server/data/flashnext.db --deck-id 10 \
  --output server/scripts/data/japanese-audio-flash-2026-10-20 \
  --kaikki server/scripts/data/japanese-n5-2026-10-19/kaikki-ja-zh.jsonl \
  --only-missing-audio --speech-model gemini-3.8-flash-tts \
  --fallback-speech-model gemini-3.1-flash-tts-preview --generate
```

`--only-missing-audio` 在计划建立时冻结选择范围和整个日语牌组卡数；正式导入后不要通过此命令重新创建该计划。只读查看结果和已保存的计划即可。

后台任务使用的环境需要显式提供 Node 路径（本机为 `--node-bin /home/pi/.nvm/versions/node/v24.9.0/bin/node`）。续跑器会在启动时检查 Node；若音频已经导入而浏览器检查中断，重新运行续跑器只重做检查，不调用模型、不再次导入。此次已验证此恢复流程，最终 `continuation.json` 为 `complete`。后台任务已结束，历史日志可通过 journalctl 查看。

查看任务状态及日志：

```bash
systemctl status flashnext-japanese-audio-flash-20261020.service
journalctl -u flashnext-japanese-audio-flash-20261020.service
```

导入器先验证整个选择范围、解码 MP3、比对指纹和哈希，再备份数据库并预写文件。在 SQLite 同一事务中再次核对词条/卡片身份，只插入缺少的媒体及背面关联；SQLite authorizer 拒绝其他表的写入（包括触发器），不调用评分或修改卡片正文。出现冲突整批回滚，清理本批临时文件。重复导入保留已有背面附件，不重复添加。

回滚只删除来源日志中仍保持原样的本批关联；被其他卡片使用的媒体不删除。已被用户更改的关联会阻止自动回滚。先预演，确认后加 `--apply`：

```bash
python3 server/scripts/import-japanese-audio.py \
  --db server/data/flashnext.db --media-dir server/data/media \
  --rollback server/data/audio-imports/<对应批次日志>.json \
  --report server/scripts/data/japanese-audio-2026-10-20/rollback-preview.json
```

## 验证

```bash
python3 server/scripts/tests/japanese-audio.py
python3 server/scripts/tests/japanese-audio-resume.py
```

共 15 项测试，覆盖促音/拗音/长音的保守检查、重复文件头拒绝、无可靠边界拒绝切分、读音失败不能入库、缓存失效、身份/文件变化保护、预演、重复导入、事务失败清理、共享文件保护和回滚后的学习数据不变，以及真实配额错误解析、每日配额快速中止、等待恢复和生成失败禁止自动导入。新增覆盖双模型格式、裸 PCM 封装、备用模型实际来源、禁止未授权模型、配额隔离、只选择缺失附件的计划，以及导入后恢复只执行校验。

数据库副本先导入 20 词，并用实际 Web 播放器验证文件哈希、MIME、Range、原有假名释义显示、背面自动播放、手机宽度及学习状态不变。只读浏览器检查命令：

```bash
node server/scripts/tests/japanese-audio-browser.cjs \
  http://127.0.0.1:19007 /dev/shm/flashnext-ja-audio-stage-20261020/pilot-import.json
```

最终生产统计和校验结果见本地批次目录中的 `verification.json`。
