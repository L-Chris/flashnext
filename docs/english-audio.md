# 英语词卡音频维护

为英语牌组今天及接下来六天的新词生成独立背面 MP3，每词朗读一次，使用已采用的默认英音、词性和用法指导。多音词的音频对应默认读音。播放沿用牌组的 `audioAutoplay` 设置，生成和导入不修改该设置。

## 选择与生成

脚本按牌组时区、日切点、每天新词额度和卡片 ID 升序选择；纳入今天首次学习的卡片，并扣除已使用的新词额度。日期是预计学习批次，不修改到期时间。已有背面音频的卡片不覆盖，未通过默认英音核验的词不生成。

先创建计划，不调用模型。以下目录只作示例，其他批次使用新目录：

```sh
python3 server/scripts/prepare-english-audio.py \
  --db server/data/flashnext.db --deck-id 9 --days 7 \
  --output server/scripts/data/english-audio/batch
```

同一目录会复用冻结计划及其哈希，不随学习进度扩大范围。词条、音标、词性、已采用发音或卡片正文发生变化时拒绝复用。添加 `--generate` 才调用付费模型：

```sh
python3 server/scripts/prepare-english-audio.py \
  --db server/data/flashnext.db --deck-id 9 --days 7 \
  --output server/scripts/data/english-audio/batch \
  --generate --workers 2 --group-size 1
```

`--limit 25` 可先试跑前 25 个词；去掉该参数继续完整计划。`--group-size 4` 可合并请求，仅在检测到精确数量的长停顿时切分，每个片段独立检查；边界不确定时回退逐词生成。

补充最近 30 个学习日（含今天）首次学习过的词，改用 `--selection recently-learned --days 30`，并选择新的批次目录。筛选依据是每张卡片全部历史中的最早复习时间，最近复习的旧词不会混入；新词额度不影响历史范围。按首次学习时间从近到远生成，已有背面音频保留。缺少已核验默认英音的词列入计划的 `blocked`，不冒充已有音频，也不阻断其他词生成。计划保留实际起止时间及哈希，续跑不会随日期扩展范围。

## 网关与读音检查

通过 `https://chat.rethinkos.com` 的 Bifrost 原生 `generateContent` 透传调用已配置的 Gemini provider。凭据只从项目 `.env` 的 `LLM_API_KEY` 读取，不进入计划、日志或媒体。声音固定为 Kore，依次使用三个已授权模型：

- `gemini-3.8-flash-tts`
- `gemini-3.1-flash-tts-preview`
- `gemini-3.8-flash-lite-tts`

3.8 使用词面正文及 `speech_metadata.style`，3.1 使用其旧版请求格式。每条证据记录实际使用的模型和切换原因。配额按模型分别处理；全部模型每日额度耗尽时保存恢复时刻并退出，返回码为 75。生成词数不等于请求数，失败重试和其他任务也会消耗额度。

先使用 `gemini/lite` 盲转写，不提供预期词面或音标；不匹配时再用 `gemini/gemini-3.8-flash` 转写。仅规范大小写、首尾标点和空白，不合并词形。通过转写后，独立检查词音完整、英音兼容、目标重音和单次朗读，四项均明确通过才可采用。置信度为 medium 时，额外要求盲音标转写与目标音标对应；不降低重音或音素标准。

词典明确支持的同音词或分词差异见 [识别例外](../server/scripts/resources/english-audio-recognition-aliases.json)，逐条绑定词面和目标音标；原始转写及词典依据保留。针对特定目标读音的提示见 [发音提示](../server/scripts/resources/english-audio-pronunciation-guidance.json)。这些资源属于可复用校订，应提交 Git。

识别例外也可记录词典明确支持、英音相同的英美拼写或空格差异，例如 `mesmerise/mesmerize` 和 `health care/healthcare`，不全局转换词形或删除空格。只有特定读音才同音的例外使用 `requiresBlindPhoneticCheck`：即使常规检查报 high，也必须额外盲转写音标并对应目标；例如 `wan` 被识别成 `one` 时必须实际读成 /wɒn/，/wʌn/ 仍被拒绝。

自动检查不等于人工审音或权威认证，产物记录 `phoneticCertified: false`。未通过的词标为 `needs_review`，禁止导入。原始 WAV、最终 MP3、哈希、切分位置、模型证据及进度全部保存在被 Git 忽略的批次目录。

读音检查也可能发现原音标错误。词典页面把某词列为变体或近义词，不代表该词可以使用页面主词的音标；发音准备器对非主词条要求精确词形、词性及 Kaikki 英音交叉证明。已有错误应通过受限音标迁移器校订，先验证副本，再备份并逐字段核查生产库；随后建立有前序哈希的新音频计划，保持原学习范围，复用身份及读音未变的已通过产物。

## 导入、验证与续跑

先对数据库及媒体副本预演：

```sh
python3 server/scripts/import-english-audio.py \
  --db /path/to/db-copy --batch server/scripts/data/english-audio/batch \
  --media-dir /path/to/media-copy --report /path/to/preview.json
```

默认不写入；应用需 `--apply --backup <新的备份路径>`。`--ready-only` 显式选择已通过项，完整导入则要求计划内每个目标词通过检查。导入重新核对身份、音标、卡片正文和文件字节，只允许写媒体表，保留已有背面附件；不修改学习状态、词条、设置或其他语言的音频。导入报告和来源日志用于核查及按批次回滚。

生产应用前暂停写入，导入后在恢复服务前运行 `verify-english-audio.py`，逐表核对备份中的非媒体数据及原有媒体，检查 MP3 哈希、关联、外键和完整性。数据库备份不包含媒体文件，恢复时需要同时保留两者。恢复学习后不要用整库备份覆盖后续学习记录。

续跑器先等待保存的配额恢复时间，再生成完整批次；全部通过后先验证副本，然后短暂停止容器、正式导入、核查并恢复服务，最后验证 Web 实际播放。生成检查失败则不进入正式导入，保留现有音频和错误记录。续跑需要宿主机 Python、ffmpeg/ffprobe、Docker、可非交互执行导入命令的 sudo，以及 Node 和浏览器测试依赖：

```sh
python3 server/scripts/resume-english-audio.py \
  --db /absolute/path/flashnext.db \
  --batch /absolute/path/batch \
  --media-dir /absolute/path/media \
  --backup-dir /absolute/path/data-backup \
  --verification /absolute/path/batch/completion-production-verification.json \
  --node-bin /absolute/path/node
```

默认容器为 `flashnext`，服务地址为 `http://127.0.0.1:9000`，可用 `--container`、`--base-url` 调整。批次的 `continuation.json` 记录状态，只有生产与播放检查均通过才标为 `complete`。脚本不安装定时任务，需要后台运行时另行交给进程管理器。

大量历史词可为续跑器指定 `--ready-only --workers 2 --group-size 4 --attempts 2`：先导入已经通过检查的缓存，每轮生成结束或配额耗尽后再导入新增通过项，随后按上游恢复时间等待；仍保留副本、非媒体表和实际播放核查。每轮写入前后只有该续跑器操作此批次，不能同时启动另一个生成器或导入器。若需接续已运行的 systemd 生成服务，传入 `--wait-for-unit <生成服务名>`，等其退出后再接管。剩余读音未通过或缺少音标时记录 `needs_review`，不会标为全部完成。

## 验证代码

```sh
python3 server/scripts/tests/english-audio.py
python3 server/scripts/tests/english-audio-resume.py
python3 server/scripts/tests/japanese-audio.py
python3 server/scripts/tests/japanese-audio-resume.py
```

这些测试使用临时数据库、模拟网关及本地音频，不调用付费模型。覆盖范围选择、严格读音检查、缓存身份、仅媒体写入、重复导入、回滚、续跑顺序和日语兼容性。

实际 Web 检查使用只读队列替换，不提交评分：

```sh
node server/scripts/tests/english-audio-browser.cjs \
  http://127.0.0.1:9000 /absolute/path/batch/applied-import.json
```

浏览器报告由调用方保存在批次目录，不提交 Git。音频生成与导入在宿主机运行，无需重建 Web 或 App。

## 响度与播放版本

英语和日语共用 `lib/audio_loudness.py`：目标 −16 LUFS，允许误差 ±1 LU，最终 MP3 的真峰值不得高于 −1.5 dBTP。这是本项目的播放目标；不是 Gemini 的数值保证。提示词要求正常、清晰、稳定的会话音量，禁止耳语、喊叫和突然变小。当前调用的原生 TTS 接口仍使用样式提示，不添加未经接口支持的 `volume`、`audioGainDb` 或 LUFS 参数。

新录音先检查 PCM：极低电平、静音或严重削波直接进入原有有界重试，避免先消耗识别与读音检查调用。通过读音检查后，从原始 WAV 生成 MP3，通过实测增益和过采样限幅校正，最多本地调整 8 次，每次重新测量最终编码文件。无法满足要求才由外层重新生成；次数由批次 `--attempts` 控制，日配额耗尽仍保存进度等待，不无限重试。仅响度可校正时不重新调用 TTS。原始 WAV、识别证据和每次测量均保留，`audioProcessing` 记录处理版本、来源/输出哈希和响度。

小于 400 ms 的单词在测量时补足分析窗，播放文件不补长、不改变语速或音高。短词不直接套用未经复测的双遍 `loudnorm` 偏移量；部分短词在该流程中会出现反向衰减。已经符合目标的历史 MP3 直接保留字节，其他历史 MP3 只从原文件生成一次播放版本。

历史录音采用新增 `media_playbacks` 表和独立 `.playback/` 文件，`media_assets`、`card_media`、原文件、学习记录和评分均不改写。卡片接口保留 `mediaId`，返回带 `?playback=<版本ID>` 的新地址及有效文件长度。原地址继续返回原文件；版本地址有独立哈希、ETag、Range、HEAD 和缓存键，避免手机复用一天前的旧内容。已安装客户端可直接使用该地址，无需为响度文件更新 APK；需重新进入应用以获取新队列。

媒体信息同时返回顶层 `sha256`，与实际选中的原文件或播放版本一致，供 App 构造内容版本缓存键；已有 `playback.sha256` 保留。此字段只增加响应信息，不涉及数据库迁移或录音重新生成。媒体接口测试使用 Node.js 内置 `node:sqlite` 创建临时数据库，可在支持该模块的 Node.js 环境运行，无需 Python 建库。

```sh
# 准备阶段只读数据库与原文件，输出在本地批次目录。
python3 server/scripts/prepare-audio-playback.py --db /absolute/db \
  --media-dir /absolute/media --output server/scripts/data/playback-batch --workers 4
# 先在数据库及媒体副本上迁移当前 schema，再添加处理版本。
python3 server/scripts/prepare-audio-playback.py --db /absolute/db-copy \
  --media-dir /absolute/media-copy --output server/scripts/data/playback-batch \
  --apply --backup /absolute/new-backup.db --report /absolute/applied.json
python3 server/scripts/verify-audio-playback.py --before /absolute/new-backup.db \
  --db /absolute/db-copy --media-dir /absolute/media-copy \
  --manifest /absolute/applied.json --report /absolute/verified.json
```

准备阶段逐个原文件校验哈希，允许断点复用同源、同处理版本且字节未变的结果；任何失败均不进入整批应用。应用仅允许新增播放表记录，拒绝覆盖同版本的既有处理结果。正式应用时停止服务写入、保留迁移前备份、先在副本核验，再短暂停机应用和逐表核查；恢复学习后不能整库覆盖回滚。需要取消本批播放时，可在事务中仅删除应用报告的 `newPlaybackIds`，原卡片会重新返回原文件地址；之后再清理已不被引用的衍生文件。不要删除原始媒体。

```sh
python3 server/scripts/tests/audio-loudness.py
node --test server/scripts/tests/audio-playback.cjs
```

上述测试包含过低电平重试、重试上限、短词、最终 MP3 响度/峰值、原始数据保护、重复应用、原始与处理版 HTTP 字节、跨资源引用拒绝、Range、HEAD、ETag 和删除关联保护。实机蓝牙响度仍需用同一条录音对比；仅文件测量不能证明手机的实际输出增益。
