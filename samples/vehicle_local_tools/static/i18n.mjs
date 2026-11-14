export const UI_LANGUAGES = Object.freeze(["en", "zh", "de", "ja", "ko"]);
const messages = [
  ["Language", "语言", "Sprache", "言語", "언어"],
  ["Auto (browser)", "自动（浏览器）", "Auto (Browser)", "自動（ブラウザー）", "자동 (브라우저)"],
  ["CONNECTED DRIVE", "智联驾驶", "VERNETZTES FAHREN", "コネクテッドドライブ", "커넥티드 드라이브"],
  ["LOCAL COCKPIT", "本地座舱", "LOKALES COCKPIT", "ローカルコックピット", "로컬 콕핏"],
  ["Azure Voice Agent for Cars", "Azure 车载语音助手", "Azure Sprachassistent fürs Auto", "Azure 車載音声エージェント", "Azure 차량 음성 에이전트"],
  ["A little more connected.", "连接，让出行更自在。", "Ein Stück besser verbunden.", "もっと、つながる。", "더 가깝게 연결됩니다."],
  ["Your voice in the cloud. Your vehicle controls, right here.", "云端理解语音，本地执行车辆操作。", "Ihre Stimme in der Cloud. Ihre Fahrzeugsteuerung vor Ort.", "音声はクラウドへ。車両操作は手元で。", "음성은 클라우드에서, 차량 제어는 여기서."],
  ["Live request pipeline", "实时请求流程", "Live-Anfrageablauf", "リクエスト処理", "실시간 요청 처리"],
  ["Request processing stages", "请求处理阶段", "Verarbeitungsschritte", "処理の段階", "요청 처리 단계"],
  ["Listen", "聆听", "Zuhören", "聞き取り", "듣기"],
  ["Browser microphone", "浏览器麦克风", "Browser-Mikrofon", "ブラウザーのマイク", "브라우저 마이크"],
  ["Select action", "选择操作", "Aktion wählen", "操作を選択", "작업 선택"],
  ["Cloud voice agent", "云端语音助手", "Cloud-Sprachassistent", "クラウド音声エージェント", "클라우드 음성 에이전트"],
  ["Search tools", "搜索工具", "Werkzeuge suchen", "ツール検索", "도구 검색"],
  ["Local catalog", "本地工具目录", "Lokaler Katalog", "ローカルカタログ", "로컬 목록"],
  ["Discover", "发现能力", "Ermitteln", "機能の検出", "기능 검색"],
  ["Matched definitions", "匹配的工具定义", "Passende Definitionen", "一致した定義", "일치하는 정의"],
  ["Execute", "执行", "Ausführen", "実行", "실행"],
  ["Policy + provider receipt", "策略检查与执行回执", "Richtlinie und Bestätigung", "ポリシーと実行結果", "정책 및 실행 확인"],
  ["Reply", "回复", "Antworten", "応答", "응답"],
  ["Actual tool result", "实际工具结果", "Tatsächliches Werkzeugergebnis", "実際のツール結果", "실제 도구 결과"],
  ["Request details", "请求详情", "Anfragedetails", "リクエスト詳細", "요청 세부 정보"],
  ["Connect voice and speak to see actual request events.", "连接语音并说话，即可查看实际请求事件。", "Verbinden Sie die Sprachfunktion, um Anfrageereignisse zu sehen.", "音声を接続すると実際の処理イベントを確認できます。", "음성을 연결하면 실제 요청 이벤트가 표시됩니다."],
  ["TOOL SELECTION", "工具选择", "WERKZEUGAUSWAHL", "ツール選択", "도구 선택"],
  ["CAPABILITY AVAILABILITY", "可用能力", "VERFÜGBARE FUNKTIONEN", "利用可能な機能", "사용 가능한 기능"],
  ["LOCAL EXECUTION", "本地执行", "LOKALE AUSFÜHRUNG", "ローカル実行", "로컬 실행"],
  ["Direct tools / no compulsory search", "直接调用工具 / 无需强制搜索", "Direkte Werkzeuge / keine Pflichtsuche", "直接ツールを実行 / 検索不要", "도구 직접 호출 / 필수 검색 없음"],
  ["Direct tools follow provider availability", "直接工具取决于提供方可用状态", "Direkte Werkzeuge nach Verfügbarkeit", "利用可能なツールを直接使用", "가용성에 따라 도구 직접 사용"],
  ["No local action yet", "尚未执行本地操作", "Noch keine lokale Aktion", "ローカル操作は未実行", "아직 로컬 작업 없음"],
  ["Observed events only / direct tools / no compulsory discovery / no hidden model reasoning", "仅显示已观测事件 / 直接工具调用 / 无需强制发现 / 不显示隐藏推理", "Nur beobachtete Ereignisse / direkte Werkzeuge / keine verborgenen Modellgedanken", "観測したイベントのみ / 直接実行 / 隠れた推論は表示しません", "관측된 이벤트만 표시 / 직접 호출 / 숨겨진 추론 없음"],
  ["DRIVING VIEW & INSTRUMENTS", "驾驶视图与仪表", "FAHRANSICHT UND INSTRUMENTE", "走行ビューと計器", "주행 화면 및 계기판"],
  ["/ Autopilot & navigation", "/ 辅助驾驶与导航", "/ Autopilot und Navigation", "/ 運転支援とナビ", "/ 주행 보조 및 내비게이션"],
  ["EPA AUTO DRIVE", "EPA 自动工况", "EPA-FAHRZYKLUS", "EPA 自動走行", "EPA 자동 주행"],
  ["AUTOPILOT ACTIVE", "辅助驾驶已启用", "AUTOPILOT AKTIV", "運転支援中", "주행 보조 활성"],
  ["VOICE OFF", "语音关闭", "SPRACHE AUS", "音声オフ", "음성 꺼짐"],
  ["VOICE LINKED", "语音已连接", "SPRACHE VERBUNDEN", "音声接続済み", "음성 연결됨"],
  ["Driving view", "驾驶视角", "Fahransicht", "走行ビュー", "주행 화면"],
  ["VIRTUAL TRAFFIC", "虚拟交通", "VIRTUELLER VERKEHR", "仮想交通", "가상 교통"],
  ["Visual only / not sensed objects", "仅用于显示 / 非传感器检测", "Nur Darstellung / keine erfassten Objekte", "表示のみ / センサー検知ではありません", "시각화 전용 / 감지된 물체 아님"],
  ["Interactive 3D driving scene with the vehicle, road and virtual traffic silhouettes", "包含车辆、道路和虚拟交通的交互式三维场景", "Interaktive 3D-Fahrszene mit Fahrzeug, Straße und virtuellem Verkehr", "車両、道路、仮想交通の3D走行シーン", "차량, 도로 및 가상 교통이 포함된 3D 주행 장면"],
  ["Navigation", "导航", "Navigation", "ナビゲーション", "내비게이션"],
  ["Navigation status", "导航状态", "Navigationsstatus", "ナビの状態", "내비게이션 상태"],
  ["No destination selected", "尚未设置目的地", "Kein Ziel ausgewählt", "目的地は未設定です", "목적지가 설정되지 않음"],
  ["Ordered itinerary", "有序行程", "Geordnete Reiseroute", "経由地リスト", "순서가 지정된 경유지"],
  ["Destination", "目的地", "Ziel", "目的地", "목적지"],
  ["Add a destination…", "添加目的地…", "Ziel hinzufügen…", "目的地を追加…", "목적지 추가…"],
  ["Add destination", "添加目的地", "Ziel hinzufügen", "目的地を追加", "목적지 추가"],
  ["Save destination", "保存目的地", "Ziel speichern", "目的地を保存", "목적지 저장"],
  ["Add", "添加", "Hinzufügen", "追加", "추가"],
  ["Save", "保存", "Speichern", "保存", "저장"],
  ["Wait", "请稍候", "Warten", "お待ちください", "잠시만요"],
  ["Edit", "编辑", "Bearbeiten", "編集", "편집"],
  ["Cancel edit", "取消编辑", "Bearbeitung abbrechen", "編集を取消", "편집 취소"],
  ["Itinerary only · no route or ETA", "仅保存行程 · 不提供路线或到达时间", "Nur Reiseroute · keine Wegführung oder Ankunftszeit", "経由地のみ · 経路や到着時刻は提供しません", "경유지 저장 전용 · 경로 및 도착 시간 없음"],
  ["Destination preferences", "目的地偏好", "Zielpräferenzen", "目的地の設定", "목적지 설정"],
  ["Clear itinerary", "清空行程", "Reiseroute löschen", "経由地を消去", "경유지 지우기"],
  ["Avoid tolls", "避开收费道路", "Maut vermeiden", "有料道路を避ける", "유료 도로 피하기"],
  ["Avoid highways", "避开高速公路", "Autobahnen vermeiden", "高速道路を避ける", "고속도로 피하기"],
  ["Autopilot", "辅助驾驶", "Autopilot", "運転支援", "주행 보조"],
  ["Engage Autopilot", "启用辅助驾驶", "Autopilot aktivieren", "運転支援を開始", "주행 보조 활성화"],
  ["Disengage Autopilot", "关闭辅助驾驶", "Autopilot deaktivieren", "運転支援を解除", "주행 보조 해제"],
  ["Set speed", "设定速度", "Sollgeschwindigkeit", "設定速度", "설정 속도"],
  ["Following gap", "跟车间距", "Folgeabstand", "車間距離", "차간 거리"],
  ["Acknowledge takeover", "确认接管", "Übernahme bestätigen", "引き継ぎを確認", "운전 인계 확인"],
  ["Vehicle access", "车辆开闭", "Fahrzeugzugang", "車両の開閉", "차량 개폐"],
  ["Doors, windows & compartments", "车门、车窗与储物舱", "Türen, Fenster und Staufächer", "ドア・窓・収納", "도어, 창문 및 수납공간"],
  ["Doors, windows & compartments.", "车门、车窗与储物舱。", "Türen, Fenster und Staufächer.", "ドア・窓・収納。", "도어, 창문 및 수납공간."],
  ["78% battery / 312 km range", "电量 78% / 续航 312 公里", "78 % Akku / 312 km Reichweite", "バッテリー78% / 航続距離312 km", "배터리 78% / 주행 가능 거리 312 km"],
  ["Reference values, not live telemetry", "参考数值，非实时遥测", "Referenzwerte, keine Live-Telemetrie", "参考値であり、実測値ではありません", "참고 값이며 실시간 측정값이 아님"],
  ["PEARL WHITE / INTERACTIVE MODEL", "珍珠白 / 交互模型", "PERLWEISS / INTERAKTIVES MODELL", "パールホワイト / インタラクティブモデル", "펄 화이트 / 인터랙티브 모델"],
  ["Download modified 3D model", "下载修改后的三维模型", "Bearbeitetes 3D-Modell herunterladen", "編集済み3Dモデルをダウンロード", "수정된 3D 모델 다운로드"],
  ["Open all doors", "打开所有车门", "Alle Türen öffnen", "すべてのドアを開く", "모든 도어 열기"],
  ["Close all doors", "关闭所有车门", "Alle Türen schließen", "すべてのドアを閉じる", "모든 도어 닫기"],
  ["Front left", "左前", "Vorne links", "左前", "앞쪽 왼쪽"],
  ["Front right", "右前", "Vorne rechts", "右前", "앞쪽 오른쪽"],
  ["Rear left", "左后", "Hinten links", "左後", "뒤쪽 왼쪽"],
  ["Rear right", "右后", "Hinten rechts", "右後", "뒤쪽 오른쪽"],
  ["Open", "已打开", "Offen", "開", "열림"],
  ["Closed", "已关闭", "Geschlossen", "閉", "닫힘"],
  ["Lower window", "降下车窗", "Fenster senken", "窓を下げる", "창문 내리기"],
  ["Raise window", "升起车窗", "Fenster heben", "窓を上げる", "창문 올리기"],
  ["Glass raised", "车窗已升起", "Fenster oben", "窓は閉じています", "창문 올라감"],
  ["Glass lowered", "车窗已降下", "Fenster unten", "窓は下がっています", "창문 내려감"],
  ["Front hood", "前备舱", "Fronthaube", "フロントフード", "앞쪽 후드"],
  ["Rear trunk", "后备厢", "Kofferraum", "リアトランク", "뒤쪽 트렁크"],
  ["Compartments", "储物舱", "Staufächer", "収納", "수납공간"],
  ["Individual passenger doors", "独立车门", "Einzelne Türen", "個別のドア", "개별 도어"],
  ["3D camera views", "三维视角", "3D-Kameraansichten", "3Dカメラビュー", "3D 카메라 시점"],
  ["VIEW", "视角", "ANSICHT", "ビュー", "시점"],
  ["Front 3/4", "前方斜视", "Vorne schräg", "前方斜め", "앞쪽 사선"],
  ["Side", "侧面", "Seite", "側面", "측면"],
  ["Rear 3/4", "后方斜视", "Hinten schräg", "後方斜め", "뒤쪽 사선"],
  ["Cockpit", "座舱", "Cockpit", "コックピット", "콕핏"],
  ["Road and wheels follow the selected motion source.", "道路和车轮跟随当前运动源。", "Straße und Räder folgen der gewählten Bewegungsquelle.", "道路と車輪は選択した走行データに連動します。", "도로와 바퀴는 선택한 주행 데이터에 연동됩니다."],
  ["EPA FTP-75 / REFERENCE SPEED", "EPA FTP-75 / 参考车速", "EPA FTP-75 / REFERENZGESCHWINDIGKEIT", "EPA FTP-75 / 参考速度", "EPA FTP-75 / 참고 속도"],
  ["EPA trace source", "EPA 工况来源", "EPA-Datenquelle", "EPAデータ出典", "EPA 데이터 출처"],
  ["Driving & display settings", "驾驶与显示设置", "Fahr- und Anzeigeeinstellungen", "走行・表示設定", "주행 및 표시 설정"],
  ["Lane keeping", "车道保持", "Spurhaltung", "車線維持", "차선 유지"],
  ["Center the vehicle in its lane", "将车辆保持在车道中央", "Fahrzeug in der Spurmitte halten", "車線の中央を維持", "차량을 차선 중앙에 유지"],
  ["Units", "单位", "Einheiten", "単位", "단위"],
  ["Metric", "公制", "Metrisch", "メートル法", "미터법"],
  ["Imperial", "英制", "Imperial", "ヤード・ポンド法", "야드파운드법"],
  ["Theme", "主题", "Design", "テーマ", "테마"],
  ["dark", "深色", "Dunkel", "ダーク", "어둡게"],
  ["light", "浅色", "Hell", "ライト", "밝게"],
  ["Layout", "布局", "Layout", "レイアウト", "레이아웃"],
  ["standard", "标准", "Standard", "標準", "표준"],
  ["compact", "紧凑", "Kompakt", "コンパクト", "간결"],
  ["Brightness", "亮度", "Helligkeit", "明るさ", "밝기"],
  ["Road conditions", "道路条件", "Straßenbedingungen", "道路状況", "도로 상황"],
  ["Clear lane", "车道畅通", "Freie Spur", "車線は良好", "차선 정상"],
  ["Slowing lead car", "前车减速", "Vorausfahrendes Fahrzeug bremst", "先行車が減速", "앞차 감속"],
  ["Lane markers lost", "车道线丢失", "Spurmarkierungen fehlen", "車線を検出できません", "차선 표시 없음"],
  ["Obstacle", "障碍物", "Hindernis", "障害物", "장애물"],
  ["Panel detail", "面板详情", "Anzeigedetails", "パネルの詳細", "패널 상세"],
  ["brief", "简洁", "Kurz", "簡潔", "간단히"],
  ["detailed", "详细", "Ausführlich", "詳細", "자세히"],
  ["Informational tips", "操作提示", "Hinweise", "操作のヒント", "도움말"],
  ["After a takeover, select Clear lane and acknowledge manually before engaging again. EPA playback continues.", "接管后，请先选择车道畅通并手动确认，再重新启用辅助驾驶。EPA 工况会继续播放。", "Nach einer Übernahme freie Spur wählen und manuell bestätigen. Der EPA-Zyklus läuft weiter.", "引き継ぎ後は車線を正常に戻し、手動で確認してから再開してください。EPA走行は継続します。", "인계 후 차선을 정상으로 설정하고 수동 확인한 뒤 다시 활성화하세요. EPA 주행은 계속됩니다."],
  ["Lane keeping centers the virtual car. Following gap changes the virtual lead-car distance target.", "车道保持使虚拟车辆居中；跟车间距用于调整与虚拟前车的目标距离。", "Spurhaltung zentriert das virtuelle Fahrzeug. Der Folgeabstand legt den Zielabstand fest.", "車線維持は仮想車両を中央に保ちます。車間設定は先行車との目標距離を変更します。", "차선 유지는 가상 차량을 중앙에 유지합니다. 차간 거리는 앞차와의 목표 거리를 조절합니다."],
  ["Browser-only visualization. Not Tesla software or FSD. NO VEHICLE HARDWARE CONNECTED. Traffic silhouettes are decorative, not sensor detections. Display settings never hide safety warnings.", "仅为浏览器可视化，非 Tesla 软件或 FSD，未连接真实车辆。交通轮廓仅用于装饰，非传感器检测。显示设置不会隐藏安全警告。", "Reine Browserdarstellung, keine Tesla-Software oder FSD. Keine Fahrzeughardware verbunden. Verkehr ist dekorativ. Sicherheitswarnungen bleiben sichtbar.", "ブラウザー上の表示のみです。TeslaソフトウェアやFSDではなく、実車とは接続されていません。交通表示は装飾です。安全警告は常に表示されます。", "브라우저 시각화 전용이며 Tesla 소프트웨어나 FSD가 아닙니다. 실제 차량에 연결되지 않습니다. 교통 표시는 장식이며 안전 경고는 숨겨지지 않습니다."],
  ["AZURE VOICE AGENT", "AZURE 语音助手", "AZURE SPRACHASSISTENT", "AZURE 音声エージェント", "AZURE 음성 에이전트"],
  ["Meet your co-pilot.", "认识你的语音助手。", "Ihr persönlicher Co-Pilot.", "あなたのコパイロット。", "나만의 코파일럿."],
  ["Ready when you are.", "随时为你准备。", "Bereit, wenn Sie es sind.", "いつでもどうぞ。", "준비되면 말씀하세요."],
  ["Speak naturally. Your cockpit follows.", "自然开口，座舱为你响应。", "Sprechen Sie natürlich. Ihr Cockpit reagiert.", "自然に話しかけてください。", "자연스럽게 말하면 콕핏이 응답합니다."],
  ["Speak English, Chinese, German, Japanese or Korean. No language switch needed.", "支持英语、中文、德语、日语、韩语，无需切换。", "Englisch, Chinesisch, Deutsch, Japanisch oder Koreanisch – ohne Sprachwechsel.", "英語・中国語・ドイツ語・日本語・韓国語に自動対応。", "영어, 중국어, 독일어, 일본어, 한국어를 전환 없이 사용하세요."],
  ["Connect voice agent", "连接语音助手", "Sprachassistent verbinden", "音声エージェントに接続", "음성 에이전트 연결"],
  ["Disconnect voice agent", "断开语音助手", "Sprachassistent trennen", "音声接続を解除", "음성 에이전트 연결 해제"],
  ["Cancel connection", "取消连接", "Verbindung abbrechen", "接続を取消", "연결 취소"],
  ["Loading cockpit…", "正在加载座舱…", "Cockpit wird geladen…", "コックピットを読み込み中…", "콕핏 로딩 중…"],
  ["Checking connection mode…", "正在检查连接模式…", "Verbindungsmodus wird geprüft…", "接続モードを確認中…", "연결 모드 확인 중…"],
  ["Your cockpit, controlled by voice.", "用语音掌控你的座舱。", "Ihr Cockpit, per Sprache gesteuert.", "声でコックピットを操作。", "음성으로 콕핏을 제어하세요."],
  ["Reconnect cockpit controls", "重新连接座舱控制", "Cockpit-Steuerung neu verbinden", "操作パネルを再接続", "콕핏 제어 다시 연결"],
  ["Connecting cockpit controls", "正在连接座舱控制", "Cockpit-Steuerung wird verbunden", "操作パネルに接続中", "콕핏 제어 연결 중"],
  ["Connecting public information", "正在连接公共信息服务", "Öffentliche Informationen werden verbunden", "公開情報に接続中", "공개 정보 연결 중"],
  ["Try saying...", "试着说…", "Sagen Sie zum Beispiel…", "話しかけてみましょう…", "이렇게 말해 보세요…"],
  ["“Engage Autopilot at 40 kilometers per hour.”", "“以每小时40公里启用辅助驾驶。”", "„Aktiviere den Autopiloten mit 40 Kilometern pro Stunde.“", "「時速40キロで運転支援を開始して。」", "“시속 40킬로미터로 주행 보조를 켜 줘.”"],
  ["“Open the front left window.”", "“打开左前车窗。”", "„Öffne das Fenster vorne links.“", "「左前の窓を開けて。」", "“앞쪽 왼쪽 창문을 열어 줘.”"],
  ["“Set the cabin to 22 degrees Celsius.”", "“把车内温度设为22摄氏度。”", "„Stelle die Temperatur auf 22 Grad Celsius.“", "「車内温度を22度にして。」", "“실내 온도를 섭씨 22도로 맞춰 줘.”"],
  ["Conversation & actions", "对话与操作", "Gespräch und Aktionen", "会話と操作", "대화 및 작업"],
  ["Clear", "清空", "Leeren", "消去", "지우기"],
  ["Your conversation appears here.", "对话将在这里显示。", "Hier erscheint Ihr Gespräch.", "会話はここに表示されます。", "대화가 여기에 표시됩니다."],
  ["Voice requests and confirmed actions.", "语音请求与已确认操作。", "Sprachanfragen und bestätigte Aktionen.", "音声リクエストと確認済みの操作。", "음성 요청 및 확인된 작업."],
  ["Answer sources", "回答来源", "Antwortquellen", "回答の出典", "답변 출처"],
  ["WebIQ not tested", "WebIQ 尚未测试", "WebIQ noch nicht getestet", "WebIQは未確認", "WebIQ 확인 전"],
  ["No web lookup for routine car controls.", "常规车辆操作不会进行网络查询。", "Keine Websuche für normale Fahrzeugsteuerung.", "通常の車両操作ではWeb検索を使いません。", "일반 차량 제어에는 웹 검색을 사용하지 않습니다."],
  ["Shared cockpit · audio sent to Azure", "共享座舱 · 音频发送至 Azure", "Geteiltes Cockpit · Audio geht an Azure", "共有コックピット · 音声はAzureへ送信", "공유 콕핏 · 음성이 Azure로 전송됨"],
  ["Climate", "空调", "Klima", "エアコン", "공조"],
  ["Power", "电源", "Ein/Aus", "電源", "전원"],
  ["Cabin temperature", "车内温度", "Innenraumtemperatur", "車内温度", "실내 온도"],
  ["Cabin temperature in Celsius", "车内温度（摄氏度）", "Innenraumtemperatur in Celsius", "車内温度（摂氏）", "실내 온도 (섭씨)"],
  ["Lower cabin temperature", "降低车内温度", "Temperatur senken", "温度を下げる", "실내 온도 낮추기"],
  ["Raise cabin temperature", "升高车内温度", "Temperatur erhöhen", "温度を上げる", "실내 온도 높이기"],
  ["Airflow", "风量", "Luftstrom", "風量", "풍량"],
  ["Auto", "自动", "Automatik", "自動", "자동"],
  ["Recirculate", "内循环", "Umluft", "内気循環", "내기 순환"],
  ["Defrost", "除霜", "Enteisen", "霜取り", "성에 제거"],
  ["Cabin settings · no climate hardware connected", "空调设置 · 未连接真实空调", "Klimaeinstellungen · keine Klimahardware verbunden", "空調設定 · 実機とは接続されていません", "공조 설정 · 실제 공조 장치에 연결되지 않음"],
  ["BLUETOOTH", "蓝牙", "BLUETOOTH", "BLUETOOTH", "블루투스"],
  ["Phone & contacts", "电话与联系人", "Telefon und Kontakte", "電話と連絡先", "전화 및 연락처"],
  ["Ready to call", "准备拨号", "Bereit zum Anrufen", "通話準備完了", "통화 준비 완료"],
  ["Connecting controls", "正在连接控制通道", "Steuerung wird verbunden", "操作パネルに接続中", "제어 연결 중"],
  ["Call duration", "通话时长", "Anrufdauer", "通話時間", "통화 시간"],
  ["Contact", "联系人", "Kontakt", "連絡先", "연락처"],
  ["Call", "拨打", "Anrufen", "発信", "전화 걸기"],
  ["Incoming", "来电", "Eingehend", "着信", "수신"],
  ["Incoming call", "来电", "Eingehender Anruf", "着信", "수신 전화"],
  ["Answer", "接听", "Annehmen", "応答", "받기"],
  ["Decline", "拒接", "Ablehnen", "拒否", "거절"],
  ["Mute", "静音", "Stummschalten", "ミュート", "음소거"],
  ["Unmute", "取消静音", "Ton einschalten", "ミュート解除", "음소거 해제"],
  ["End call", "挂断", "Auflegen", "通話を終了", "통화 종료"],
  ["Address book", "通讯录", "Adressbuch", "アドレス帳", "주소록"],
  ["Search contacts", "搜索联系人", "Kontakte suchen", "連絡先を検索", "연락처 검색"],
  ["Find a contact…", "查找联系人…", "Kontakt suchen…", "連絡先を検索…", "연락처 찾기…"],
  ["No matching contacts.", "没有匹配的联系人。", "Keine passenden Kontakte.", "一致する連絡先はありません。", "일치하는 연락처가 없습니다."],
  ["Panel preferences", "面板偏好", "Anzeigeeinstellungen", "パネル設定", "패널 설정"],
  ["Panel notifications", "面板通知", "Panel-Benachrichtigungen", "パネル通知", "패널 알림"],
  ["Detail", "详情", "Details", "詳細", "상세"],
  ["Music", "音乐", "Musik", "音楽", "음악"],
  ["Evening Drive", "晚间兜风", "Abendfahrt", "イブニングドライブ", "저녁 드라이브"],
  ["City Lights", "城市灯火", "Stadtlichter", "シティライト", "도시의 불빛"],
  ["Quiet Horizon", "静谧地平线", "Stiller Horizont", "静かな地平線", "고요한 지평선"],
  ["Coastal Breeze", "海岸微风", "Küstenbrise", "海辺のそよ風", "해안의 바람"],
  ["AURA original · continuous mix", "AURA 原创 · 循环播放", "AURA Original · Endlosschleife", "AURAオリジナル · ループ再生", "AURA 오리지널 · 반복 재생"],
  ["Playback controls", "播放控制", "Wiedergabesteuerung", "再生操作", "재생 제어"],
  ["Play local audio", "播放本地音频", "Lokale Audiodatei abspielen", "ローカル音声を再生", "로컬 오디오 재생"],
  ["Pause local audio", "暂停本地音频", "Lokale Audiodatei pausieren", "ローカル音声を一時停止", "로컬 오디오 일시 정지"],
  ["Playback position in seconds", "播放位置（秒）", "Wiedergabeposition in Sekunden", "再生位置（秒）", "재생 위치 (초)"],
  ["Mute audio", "音频静音", "Audio stummschalten", "音声をミュート", "오디오 음소거"],
  ["Unmute audio", "取消音频静音", "Audioton einschalten", "音声ミュートを解除", "오디오 음소거 해제"],
  ["Media volume", "媒体音量", "Medienlautstärke", "メディア音量", "미디어 음량"],
  ["Music source", "音乐来源", "Musikquelle", "音楽ソース", "음악 소스"],
  ["Music preset", "预设音乐", "Musik-Voreinstellung", "プリセット曲", "음악 프리셋"],
  ["Previous track", "上一首", "Vorheriger Titel", "前の曲", "이전 곡"],
  ["Next track", "下一首", "Nächster Titel", "次の曲", "다음 곡"],
  ["Load the AURA original track", "加载 AURA 原创音乐", "AURA Original laden", "AURAオリジナルを読み込み", "AURA 오리지널 불러오기"],
  ["AURA original", "AURA 原创", "AURA Original", "AURAオリジナル", "AURA 오리지널"],
  ["Open audio file", "打开音频文件", "Audiodatei öffnen", "音声ファイルを開く", "오디오 파일 열기"],
  ["On-device playback · your files stay private", "本机播放 · 文件不会上传", "Wiedergabe auf dem Gerät · Ihre Dateien bleiben privat", "端末内で再生 · ファイルは送信されません", "기기 내 재생 · 파일이 업로드되지 않음"],
  ["Cloud intelligence. Local authority.", "云端智能，本地掌控。", "Cloud-Intelligenz. Lokale Kontrolle.", "クラウドの知能。ローカルの制御。", "클라우드 지능. 로컬 제어."],
  ["LOCAL COCKPIT — NOT FOR DRIVING", "本地座舱 — 不可用于实际驾驶", "LOKALES COCKPIT — NICHT ZUM FAHREN", "ローカルコックピット — 実際の運転には使用しないでください", "로컬 콕핏 — 실제 운전에 사용하지 마세요"],
  ["READY", "就绪", "BEREIT", "準備完了", "준비 완료"],
  ["OFFLINE", "离线", "OFFLINE", "オフライン", "오프라인"],
  ["AVAILABLE", "可连接", "VERFÜGBAR", "接続可能", "연결 가능"],
  ["CONNECTED", "已连接", "VERBUNDEN", "接続済み", "연결됨"],
  ["DISCONNECTED", "已断开", "GETRENNT", "切断済み", "연결 끊김"],
  ["CONNECTING", "连接中", "VERBINDEN", "接続中", "연결 중"],
  ["CONTROLS CONNECTING", "控制通道连接中", "STEUERUNG VERBINDET", "操作パネル接続中", "제어 연결 중"],
  ["CONTROLS READY", "控制通道就绪", "STEUERUNG BEREIT", "操作パネル準備完了", "제어 준비 완료"],
  ["CONTROLS OFFLINE", "控制通道离线", "STEUERUNG OFFLINE", "操作パネル未接続", "제어 오프라인"],
  ["Controls connected", "控制通道已连接", "Steuerung verbunden", "操作パネル接続済み", "제어 연결됨"],
  ["Controls disconnected", "控制通道已断开", "Steuerung getrennt", "操作パネル切断済み", "제어 연결 끊김"],
  ["Controls disconnected / assistance off", "控制通道已断开 / 辅助驾驶已关闭", "Steuerung getrennt / Assistenz aus", "操作パネル切断 / 運転支援オフ", "제어 연결 끊김 / 주행 보조 꺼짐"],
  ["Voice linked to this cockpit", "语音已关联当前座舱", "Sprache mit diesem Cockpit verbunden", "このコックピットに音声接続済み", "이 콕핏에 음성 연결됨"],
  ["Cockpit ready / microphone off", "座舱就绪 / 麦克风关闭", "Cockpit bereit / Mikrofon aus", "コックピット準備完了 / マイクオフ", "콕핏 준비 완료 / 마이크 꺼짐"],
  ["Cockpit disconnected", "座舱已断开", "Cockpit getrennt", "コックピット切断済み", "콕핏 연결 끊김"],
  ["Microphone off. Local controls remain available.", "麦克风已关闭，仍可使用本地控制。", "Mikrofon aus. Lokale Steuerung bleibt verfügbar.", "マイクはオフです。ローカル操作は利用できます。", "마이크가 꺼졌습니다. 로컬 제어는 계속 사용할 수 있습니다."],
  ["Microphone stays off until you connect.", "连接前麦克风保持关闭。", "Das Mikrofon bleibt bis zur Verbindung aus.", "接続するまでマイクはオフです。", "연결할 때까지 마이크는 꺼져 있습니다."],
  ["Requesting microphone access and opening cloud session…", "正在申请麦克风权限并连接云端…", "Mikrofonzugriff und Cloud-Sitzung werden angefordert…", "マイクの許可を確認し、クラウドに接続中…", "마이크 권한 요청 및 클라우드 연결 중…"],
  ["Microphone on. Speak naturally. Talk over a reply to interrupt it.", "麦克风已开启。自然说话即可；可直接打断回复。", "Mikrofon an. Sprechen Sie natürlich. Sie können Antworten unterbrechen.", "マイクはオンです。自然に話しかけ、応答中も割り込めます。", "마이크가 켜졌습니다. 자연스럽게 말하고 응답 중 끼어들 수 있습니다."],
  ["Let's take it from here.", "接下来交给我。", "Ab hier übernehme ich.", "ここからお手伝いします。", "이제 제가 도와드릴게요."],
  ["AI agent disconnected", "语音助手未连接", "KI-Assistent getrennt", "AIエージェント未接続", "AI 에이전트 연결 끊김"],
  ["AI agent connecting", "语音助手连接中", "KI-Assistent verbindet", "AIエージェント接続中", "AI 에이전트 연결 중"],
  ["AI agent connected and active", "语音助手已连接并就绪", "KI-Assistent verbunden und aktiv", "AIエージェント接続・動作中", "AI 에이전트 연결 및 활성화됨"],
  ["Listening to you.", "正在聆听。", "Ich höre zu.", "聞いています。", "듣고 있어요."],
  ["Choosing the next action.", "正在选择下一步操作。", "Nächste Aktion wird gewählt.", "次の操作を選択中。", "다음 작업 선택 중."],
  ["Updating your cockpit.", "正在更新座舱。", "Cockpit wird aktualisiert.", "コックピットを更新中。", "콕핏 업데이트 중."],
  ["Cockpit update confirmed.", "座舱更新已确认。", "Cockpit-Aktualisierung bestätigt.", "更新を確認しました。", "콕핏 업데이트 확인됨."],
  ["The requested update could not be completed.", "未能完成所请求的更新。", "Die Aktualisierung konnte nicht abgeschlossen werden.", "更新を完了できませんでした。", "요청한 업데이트를 완료할 수 없습니다."],
  ["Preparing your reply.", "正在准备回复。", "Antwort wird vorbereitet.", "応答を準備中。", "응답 준비 중."],
  ["Ready for your next request.", "可以继续提出请求。", "Bereit für Ihre nächste Anfrage.", "次のリクエストをどうぞ。", "다음 요청을 말씀하세요."],
  ["All doors closed", "所有车门已关闭", "Alle Türen geschlossen", "すべてのドアが閉じています", "모든 도어 닫힘"],
  ["{count} of 4 doors open", "4 扇车门中有 {count} 扇已打开", "{count} von 4 Türen offen", "4枚中{count}枚のドアが開いています", "도어 4개 중 {count}개 열림"],
  ["Lower {door} window", "降下{door}车窗", "Fenster {door} senken", "{door}の窓を下げる", "{door} 창문 내리기"],
  ["Raise {door} window", "升起{door}车窗", "Fenster {door} heben", "{door}の窓を上げる", "{door} 창문 올리기"],
  ["CLEARING", "清空中", "LÖSCHEN", "消去中", "지우는 중"],
  ["SAVING", "保存中", "SPEICHERN", "保存中", "저장 중"],
  ["UPDATING", "更新中", "AKTUALISIEREN", "更新中", "업데이트 중"],
  ["FAILED", "失败", "FEHLGESCHLAGEN", "失敗", "실패"],
  ["SAVED", "已保存", "GESPEICHERT", "保存済み", "저장됨"],
  ["NOT SET", "未设置", "NICHT GESETZT", "未設定", "설정되지 않음"],
  ["Waiting for cockpit confirmation.", "正在等待座舱确认。", "Warte auf Cockpit-Bestätigung.", "コックピットの確認待ち。", "콕핏 확인 대기 중."],
  ["Update not confirmed. Check saved destination.", "更新未确认，请检查已保存的目的地。", "Aktualisierung nicht bestätigt. Gespeichertes Ziel prüfen.", "更新は未確認です。保存済みの目的地を確認してください。", "업데이트가 확인되지 않았습니다. 저장된 목적지를 확인하세요."],
  ["{count} / 8 stops saved · no route or ETA", "已保存 {count} / 8 个站点 · 无路线或到达时间", "{count} / 8 Stopps gespeichert · keine Route oder Ankunftszeit", "{count} / 8 件保存済み · 経路・到着時刻なし", "경유지 {count} / 8개 저장됨 · 경로 및 도착 시간 없음"],
  ["Up to 8 stops · no route or ETA", "最多 8 个站点 · 无路线或到达时间", "Bis zu 8 Stopps · keine Route oder Ankunftszeit", "最大8件 · 経路・到着時刻なし", "최대 경유지 8개 · 경로 및 도착 시간 없음"],
  ["Edit stop {number}", "编辑第 {number} 站", "Stopp {number} bearbeiten", "経由地{number}を編集", "경유지 {number} 편집"],
  ["Remove stop {number}", "删除第 {number} 站", "Stopp {number} entfernen", "経由地{number}を削除", "경유지 {number} 삭제"],
  ["Preferences · {count} selected", "偏好 · 已选择 {count} 项", "Präferenzen · {count} ausgewählt", "設定 · {count}件選択", "설정 · {count}개 선택됨"],
  ["NOW PLAYING", "正在播放", "WIRD ABGESPIELT", "再生中", "재생 중"],
  ["AUDIO READY", "音频就绪", "AUDIO BEREIT", "音声準備完了", "오디오 준비 완료"],
  ["AUDIO ERROR", "音频错误", "AUDIOFEHLER", "音声エラー", "오디오 오류"],
  ["LOADING AUDIO", "正在加载音频", "AUDIO WIRD GELADEN", "音声読み込み中", "오디오 로딩 중"],
  ["NO AUDIO SOURCE", "无音频来源", "KEINE AUDIOQUELLE", "音声ソースなし", "오디오 소스 없음"],
  ["Your library · on this device", "你的曲库 · 仅在本机", "Ihre Bibliothek · auf diesem Gerät", "ライブラリー · この端末内", "내 라이브러리 · 이 기기"],
  ["DIALING", "拨号中", "WÄHLEN", "発信中", "전화 거는 중"],
  ["INCOMING", "来电", "EINGEHEND", "着信中", "수신 중"],
  ["ACTIVE", "通话中", "AKTIV", "通話中", "통화 중"],
  ["Dialing", "正在拨号", "Wählen", "発信中", "전화 거는 중"],
  ["Call active / muted", "通话中 / 已静音", "Anruf aktiv / stumm", "通話中 / ミュート", "통화 중 / 음소거"],
  ["Call active", "通话中", "Anruf aktiv", "通話中", "통화 중"],
  ["{count} contacts", "{count} 位联系人", "{count} Kontakte", "連絡先{count}件", "연락처 {count}개"],
  ["Contact / select", "联系人 / 选择", "Kontakt / auswählen", "連絡先 / 選択", "연락처 / 선택"],
  ["Panel notifications enabled", "面板通知已开启", "Panel-Benachrichtigungen an", "パネル通知オン", "패널 알림 켜짐"],
  ["Panel notifications disabled", "面板通知已关闭", "Panel-Benachrichtigungen aus", "パネル通知オフ", "패널 알림 꺼짐"],
  ["Select a contact from the address book to call.", "从通讯录中选择联系人进行拨号。", "Wählen Sie einen Kontakt zum Anrufen.", "アドレス帳から連絡先を選択してください。", "주소록에서 통화할 연락처를 선택하세요."],
  ["On · public information only", "已开启 · 仅公共信息", "An · nur öffentliche Informationen", "オン · 公開情報のみ", "켜짐 · 공개 정보만"],
  ["On · sources available", "已开启 · 来源可用", "An · Quellen verfügbar", "オン · 出典あり", "켜짐 · 출처 사용 가능"],
  ["Unavailable · authentication failed", "不可用 · 身份验证失败", "Nicht verfügbar · Anmeldung fehlgeschlagen", "利用不可 · 認証失敗", "사용 불가 · 인증 실패"],
  ["Unavailable · service error", "不可用 · 服务错误", "Nicht verfügbar · Dienstfehler", "利用不可 · サービスエラー", "사용 불가 · 서비스 오류"],
  ["Unavailable · connection failed", "不可用 · 连接失败", "Nicht verfügbar · Verbindung fehlgeschlagen", "利用不可 · 接続失敗", "사용 불가 · 연결 실패"],
  ["Unavailable · response error", "不可用 · 响应错误", "Nicht verfügbar · Antwortfehler", "利用不可 · 応答エラー", "사용 불가 · 응답 오류"],
  ["Lookup failed · ask again", "查询失败 · 请重试", "Suche fehlgeschlagen · erneut fragen", "検索失敗 · 再試行してください", "검색 실패 · 다시 요청하세요"],
  ["Lookup timed out · ask again", "查询超时 · 请重试", "Zeitüberschreitung · erneut fragen", "検索時間切れ · 再試行してください", "검색 시간 초과 · 다시 요청하세요"],
  ["Updating preference…", "正在更新偏好…", "Einstellung wird aktualisiert…", "設定を更新中…", "설정 업데이트 중…"],
  ["Off · model knowledge", "已关闭 · 使用模型知识", "Aus · Modellwissen", "オフ · モデルの知識", "꺼짐 · 모델 지식"],
  ["Unavailable · not configured", "不可用 · 尚未配置", "Nicht verfügbar · nicht konfiguriert", "利用不可 · 未設定", "사용 불가 · 구성되지 않음"],
  ["Answer sources ({count})", "回答来源（{count}）", "Antwortquellen ({count})", "回答の出典（{count}）", "답변 출처 ({count})"],
  ["Cached evidence", "缓存的资料", "Zwischengespeicherte Belege", "キャッシュ済み資料", "캐시된 자료"],
  ["Retrieved evidence", "检索的资料", "Abgerufene Belege", "取得した資料", "검색된 자료"],
  ["EPA loop playing", "EPA 工况播放中", "EPA-Zyklus läuft", "EPA走行を再生中", "EPA 주행 재생 중"],
  ["assisted driving", "辅助驾驶", "Assistiertes Fahren", "運転支援", "주행 보조"],
  ["active", "已启用", "Aktiv", "作動中", "활성"],
  ["disengaged", "已关闭", "Deaktiviert", "解除済み", "해제됨"],
  ["takeover required", "需要接管", "Übernahme erforderlich", "引き継ぎが必要", "운전 인계 필요"],
  ["fault", "故障", "Fehler", "異常", "오류"],
  ["EPA cycle plays automatically. Engage Autopilot to take over speed.", "EPA 工况自动播放，启用辅助驾驶即可接管速度。", "Der EPA-Zyklus läuft automatisch. Autopilot übernimmt die Geschwindigkeit.", "EPA走行を自動再生します。運転支援を開始すると速度制御を引き継ぎます。", "EPA 주행이 자동 재생됩니다. 주행 보조를 켜면 속도를 제어합니다."],
  ["Autopilot controls speed and lane assistance. Disengage to return to EPA.", "辅助驾驶控制速度和车道，关闭后返回 EPA 工况。", "Autopilot steuert Geschwindigkeit und Spur. Deaktivieren für EPA.", "運転支援が速度と車線を制御します。解除するとEPA走行に戻ります。", "주행 보조가 속도와 차선을 제어합니다. 해제하면 EPA로 돌아갑니다."],
  ["{reason}. EPA playback continues.", "{reason}。EPA 工况继续播放。", "{reason}. Der EPA-Zyklus läuft weiter.", "{reason}。EPA走行は継続します。", "{reason}. EPA 주행은 계속됩니다."],
  ["TARGET {speed} KM/H", "目标 {speed} 公里/小时", "ZIEL {speed} KM/H", "目標 {speed} KM/H", "목표 {speed} KM/H"],
  ["EPA FTP-75 / AUTO LOOP", "EPA FTP-75 / 自动循环", "EPA FTP-75 / AUTOMATISCH", "EPA FTP-75 / 自動ループ", "EPA FTP-75 / 자동 반복"],
  ["playing", "播放中", "läuft", "再生中", "재생 중"],
  ["Lead vehicle {distance} m ahead", "前车在 {distance} 米处", "Vorausfahrendes Fahrzeug in {distance} m", "先行車まで{distance} m", "앞차까지 {distance} m"],
  ["EPA FTP-75 / automatic loop", "EPA FTP-75 / 自动循环", "EPA FTP-75 / automatischer Zyklus", "EPA FTP-75 / 自動ループ", "EPA FTP-75 / 자동 반복"],
  ["Autopilot / speed control", "辅助驾驶 / 速度控制", "Autopilot / Geschwindigkeitsregelung", "運転支援 / 速度制御", "주행 보조 / 속도 제어"],
  ["Autopilot speed override", "辅助驾驶接管速度", "Autopilot-Geschwindigkeitssteuerung", "運転支援による速度制御", "주행 보조 속도 제어"],
  ["Reduced motion / road, traffic and wheels held still", "减弱动画 / 道路、交通和车轮保持静止", "Reduzierte Bewegung / Straße, Verkehr und Räder stehen still", "動きを抑制 / 道路・交通・車輪を静止", "동작 줄이기 / 도로, 교통 및 바퀴 정지"],
  ["Virtual road / drag to orbit / scroll to zoom", "虚拟道路 / 拖动旋转 / 滚动缩放", "Virtuelle Straße / ziehen zum Drehen / scrollen zum Zoomen", "仮想道路 / ドラッグで回転 / スクロールで拡大", "가상 도로 / 드래그로 회전 / 스크롤로 확대"],
  ["Loading your 3D vehicle...", "正在加载三维车辆…", "3D-Fahrzeug wird geladen…", "3D車両を読み込み中…", "3D 차량 로딩 중…"],
  ["Loading driving cycle...", "正在加载驾驶工况…", "Fahrzyklus wird geladen…", "走行サイクルを読み込み中…", "주행 사이클 로딩 중…"],
  ["Loading automatic drive cycle...", "正在加载自动驾驶工况…", "Automatischer Fahrzyklus wird geladen…", "自動走行サイクルを読み込み中…", "자동 주행 사이클 로딩 중…"],
  ["PROCESS INTERRUPTED", "流程已中断", "VORGANG UNTERBROCHEN", "処理中断", "처리 중단"],
  ["TURN {turn} / {stage}", "第 {turn} 轮 / {stage}", "RUNDE {turn} / {stage}", "ターン{turn} / {stage}", "턴 {turn} / {stage}"],
  ["RESPONSE READY", "回复就绪", "ANTWORT BEREIT", "応答準備完了", "응답 준비 완료"],
  ["INTERRUPTED", "已中断", "UNTERBROCHEN", "中断", "중단됨"],
  ["Direct tools / no discovery required", "直接工具调用 / 无需发现", "Direkte Werkzeuge / keine Ermittlung nötig", "直接実行 / 検出不要", "직접 도구 / 검색 불필요"],
  ["Available direct tools are selected by capability", "根据能力选择可用的直接工具", "Direkte Werkzeuge werden nach Funktion gewählt", "機能に応じて利用可能なツールを選択", "기능에 따라 직접 도구 선택"],
  ["Direct tool call / no search", "直接工具调用 / 无搜索", "Direkter Werkzeugaufruf / keine Suche", "直接ツール実行 / 検索なし", "도구 직접 호출 / 검색 없음"],
  ["No discovery round trip", "无能力发现往返", "Keine Ermittlungsschleife", "検出の往復なし", "기능 검색 왕복 없음"],
  ["YOU", "你", "SIE", "あなた", "사용자"],
  ["VOICE AGENT", "语音助手", "SPRACHASSISTENT", "音声エージェント", "음성 에이전트"],
  ["LISTENING", "聆听中", "ZUHÖREN", "聞き取り中", "듣는 중"],
  ["UNDERSTANDING", "理解中", "VERSTEHEN", "理解中", "이해 중"],
  ["SEARCHING", "搜索中", "SUCHEN", "検索中", "검색 중"],
  ["DISCOVERED", "已发现", "GEFUNDEN", "検出済み", "검색 완료"],
  ["EXECUTING", "执行中", "AUSFÜHREN", "実行中", "실행 중"],
  ["RESULT", "执行结果", "ERGEBNIS", "結果", "결과"],
  ["RESPONDING", "回复中", "ANTWORTEN", "応答中", "응답 중"],
  ["COMPLETE", "已完成", "ABGESCHLOSSEN", "完了", "완료"],
  ["Call ended", "通话已结束", "Anruf beendet", "通話終了", "통화 종료됨"],
  ["Call declined", "已拒接", "Anruf abgelehnt", "着信を拒否しました", "전화 거절됨"],
  ["Page hidden", "页面处于后台", "Seite im Hintergrund", "ページが非表示", "페이지가 백그라운드에 있음"],
  ["Control connection lost", "控制连接已丢失", "Steuerverbindung verloren", "操作パネルの接続切れ", "제어 연결 끊김"],
  ["Body opening interlock", "车门或储物舱未关闭", "Tür oder Staufach offen", "ドアまたは収納が開いています", "도어 또는 수납공간이 열려 있음"],
  ["Obstacle: take over", "前方障碍物：请接管", "Hindernis: übernehmen", "障害物：運転を引き継いでください", "장애물: 운전을 인계하세요"],
  ["Lane markers lost: take over", "车道线丢失：请接管", "Spurmarkierungen fehlen: übernehmen", "車線検出不能：運転を引き継いでください", "차선 표시 없음: 운전을 인계하세요"],
  ["Lead car too close: take over", "前车过近：请接管", "Vorausfahrendes Fahrzeug zu nah: übernehmen", "先行車に接近：運転を引き継いでください", "앞차가 너무 가까움: 운전을 인계하세요"],
  ["Offline cockpit", "离线座舱", "Offline-Cockpit", "オフラインコックピット", "오프라인 콕핏"],
  ["Explore your cockpit.", "体验你的座舱。", "Entdecken Sie Ihr Cockpit.", "コックピットをお試しください。", "콕핏을 둘러보세요."],
  ["Explore local controls. Voice is offline.", "可体验本地控制，语音当前离线。", "Lokale Steuerung erkunden. Sprache ist offline.", "ローカル操作を利用できます。音声はオフラインです。", "로컬 제어를 사용하세요. 음성은 오프라인입니다."],
  ["Voice is unavailable in offline mode. Start the server with cloud voice enabled.", "离线模式无法使用语音，请启用云端语音后启动服务。", "Sprache ist offline nicht verfügbar. Server mit Cloud-Sprache starten.", "オフラインでは音声を利用できません。クラウド音声を有効にして起動してください。", "오프라인 모드에서는 음성을 사용할 수 없습니다. 클라우드 음성을 활성화하세요."],
  ["Cockpit unavailable", "座舱不可用", "Cockpit nicht verfügbar", "コックピットを利用できません", "콕핏 사용 불가"],
  ["Shared vehicle controls, one voice session at a time, {minutes} minutes per session and {starts} starts per rolling day across all visitors. Do not enter private information. Audio is sent to Azure.", "车辆控制由访客共享，同时仅允许一个语音会话，每次 {minutes} 分钟，所有访客每天合计最多启动 {starts} 次。请勿输入私人信息，音频会发送至 Azure。", "Geteilte Fahrzeugsteuerung: eine Sprachsitzung gleichzeitig, {minutes} Minuten je Sitzung und {starts} Starts pro Tag für alle Besucher. Keine privaten Daten eingeben. Audio wird an Azure gesendet.", "車両操作は共有です。音声は同時に1セッション、各{minutes}分、全訪問者で1日{starts}回までです。個人情報を入力しないでください。音声はAzureに送信されます。", "차량 제어가 공유됩니다. 음성은 동시에 한 세션, 세션당 {minutes}분, 전체 방문자 기준 하루 {starts}회까지입니다. 개인 정보를 입력하지 마세요. 음성은 Azure로 전송됩니다."],
  ["Enter a destination first.", "请先输入目的地。", "Geben Sie zuerst ein Ziel ein.", "先に目的地を入力してください。", "먼저 목적지를 입력하세요."],
  ["Selected audio cannot be decoded. Choose another supported file.", "无法解码所选音频，请选择其他支持的文件。", "Audio kann nicht dekodiert werden. Andere unterstützte Datei wählen.", "音声を読み込めません。対応する別のファイルを選んでください。", "오디오를 읽을 수 없습니다. 지원되는 다른 파일을 선택하세요."],
  ["The itinerary changed. Select a stop again before editing.", "行程已变化，请重新选择要编辑的站点。", "Die Reiseroute wurde geändert. Stopp zum Bearbeiten erneut wählen.", "経由地が変更されました。編集する経由地を選び直してください。", "경유지가 변경되었습니다. 편집할 경유지를 다시 선택하세요."],
  ["On: public web information. Off: model knowledge. Vehicle controls never use Web IQ.", "开启：使用公共网络信息；关闭：使用模型知识。车辆控制不会使用 Web IQ。", "An: öffentliche Webinformationen. Aus: Modellwissen. Fahrzeugsteuerung nutzt nie Web IQ.", "オン：公開Web情報。オフ：モデルの知識。車両操作ではWeb IQを使いません。", "켜짐: 공개 웹 정보. 꺼짐: 모델 지식. 차량 제어에는 Web IQ를 사용하지 않습니다."],
  ["3D graphics context lost. Reload the cockpit to restore the model.", "三维图形上下文已丢失，请重新加载座舱以恢复模型。", "3D-Grafikkontext verloren. Cockpit zum Wiederherstellen neu laden.", "3D描画が停止しました。ページを再読み込みしてください。", "3D 그래픽 연결이 끊겼습니다. 페이지를 새로고침하세요."],
];

export const TRANSLATIONS = Object.freeze(Object.fromEntries(messages.map(([key, ...values]) => [key, Object.freeze(values)])));
const storageKey = "aura.ui.language";
export function resolveLanguage(choice, browserLanguages = []) {
  if (choice !== "auto") {
    if (!UI_LANGUAGES.includes(choice)) throw new Error("Unsupported UI language.");
    return choice;
  }
  return browserLanguages.map((value) => value.toLowerCase().split(/[-_]/)[0])
    .find((value) => UI_LANGUAGES.includes(value)) || "en";
}

let choice = "auto";
let language = "en";
const textBindings = new Map();
const staticBindings = [];
export function currentLanguage() { return language; }
export function translate(message, params = {}, locale = language) {
  if (!UI_LANGUAGES.includes(locale)) throw new Error("Unsupported UI language.");
  if (!Object.hasOwn(TRANSLATIONS, message)) return message;
  const index = UI_LANGUAGES.indexOf(locale) - 1;
  const template = index < 0 ? message : TRANSLATIONS[message]?.[index] ?? message;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    if (!(key in params)) throw new Error(`Missing translation parameter: ${key}`);
    return String(params[key]);
  });
}
export const t = translate;
export function clearTextBinding(id) { textBindings.delete(id); }
export function setText(id, message, params = {}) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing localized element: ${id}`);
  textBindings.set(id, { message, params });
  const value = t(message, params);
  if (node.textContent !== value) node.textContent = value;
}

function renderLanguage() {
  document.documentElement.lang = language;
  document.title = `${t("Azure Voice Agent for Cars")} / AURA`;
  for (const binding of staticBindings) {
    if (!binding.element.isConnected) continue;
    const value = t(binding.message);
    if (binding.attribute) binding.element.setAttribute(binding.attribute, value);
    else if (binding.node.isConnected) binding.node.nodeValue = binding.leading + value + binding.trailing;
  }
  for (const [id, binding] of textBindings) setText(id, binding.message, binding.params);
  document.getElementById("ui-language").value = choice;
  document.querySelector('#ui-language option[value="auto"]').textContent = t("Auto (browser)");
}

export function setLanguage(value, { persist = true } = {}) {
  const next = resolveLanguage(value, navigator.languages || [navigator.language]);
  choice = value; language = next;
  if (persist) {
    try { localStorage.setItem(storageKey, choice); }
    catch (error) {
      document.dispatchEvent(new CustomEvent("cockpit-error", { detail: `UI language could not be saved: ${error.message}` }));
    }
  }
  renderLanguage();
  document.dispatchEvent(new CustomEvent("ui-language-change", { detail: { language, choice } }));
}

function initialize() {
  // Preserve protocol values for options whose values originally come from their labels.
  for (const option of document.querySelectorAll("option:not([value])")) option.value = option.textContent;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, element = node.parentElement;
    if (element.closest("script, style, #ui-language")) continue;
    const message = node.nodeValue.trim();
    if (Object.hasOwn(TRANSLATIONS, message)) staticBindings.push({
      element, node, message, leading: node.nodeValue.match(/^\s*/)[0], trailing: node.nodeValue.match(/\s*$/)[0],
    });
  }
  for (const element of document.querySelectorAll("[aria-label], [placeholder], [title]")) {
    for (const attribute of ["aria-label", "placeholder", "title"]) {
      const message = element.getAttribute(attribute);
      if (message && Object.hasOwn(TRANSLATIONS, message)) staticBindings.push({ element, attribute, message });
    }
  }
  let saved = "auto";
  try {
    saved = localStorage.getItem(storageKey) || "auto";
    resolveLanguage(saved);
  } catch (error) {
    console.error("Could not restore UI language.", error);
    saved = "auto";
  }
  setLanguage(saved, { persist: false });
  document.getElementById("ui-language").addEventListener("change", (event) => setLanguage(event.target.value));
  window.addEventListener("languagechange", () => { if (choice === "auto") setLanguage("auto", { persist: false }); });
}

if (typeof document !== "undefined") initialize();
