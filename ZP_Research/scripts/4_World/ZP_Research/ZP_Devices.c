// Прилади ZP. ZP_Device_Base несе машину станів фонової станції (M2b):
// вхідні предмети/витратні матеріали — у КАРГО приладу (універсально для предметів будь-яких
// модів, без CfgSlots-правок чужих класів), істина часу — timestamp (переживає перезапуск,
// урок CannabisPlus), таймер опитування лише звіряється з ним.
class ZP_Device_Base : ItemBase
{
    static const int ZP_STATE_IDLE = 0;
    static const int ZP_STATE_RUNNING = 1;
    // ЗУПИНЕНО: цикл скінчився, але вихід НЕ ВМІСТИВСЯ в карго. Конвеєр стоїть, доки
    // гравець не звільнить місце й не забере залишок. Таймер тут зупинений повністю.
    static const int ZP_STATE_DONE = 2;

    int m_ZP_State;
    string m_ZP_RuleId;           // зберігається (CF_ModStorage)
    int m_ZP_EndSec;              // ZP_Now.EpochSec завершення
    string m_ZP_StarterUid;       // Steam64 ініціатора — лише мітка для логів
    string m_ZP_StarterFaction;   // фракція ініціатора на момент старту (v2: офлайн-маршрутизація пулу)
    // Предмети, які НЕ ВМІСТИЛИСЬ у карго (звичайно порожньо: вихід викладається одразу).
    // Це ЗАПИС У СХОВИЩІ, а не річ у світі — на підлогу такий залишок не падає й переживає
    // перезапуск; матеріалізується, коли звільнять місце.
    ref array<string> m_ZP_PendingItems = new array<string>();
    // Вміст незакладених зразків. Паралельний масив до m_ZP_PendingItems: без нього
    // застряглий зразок відродився б ПУСТИМ — клас у всіх зразків один, і вміст відновити
    // не було б звідки (обмеження розділу 5.0). Довжини завжди рівні: пишуться й читаються
    // разом, а при пошкодженому потоці обидва скидаються в порожні.
    ref array<string> m_ZP_PendingContents = new array<string>();
    // Чистота незакладених зразків: заморожена на дедлайні так само, як вміст. Без неї
    // застряглий зразок віддали б із чистотою поточного циклу, а не свого власного.
    ref array<float> m_ZP_PendingPurities = new array<float>();
    // ЗАМОРОЖЕНА ЧИСТОТА ПОТОЧНОГО ЦИКЛУ (v7). Рахується ПРИ СТАРТІ, поки з'їдені предмети
    // ще існують: кидок іде наприкінці — можливо, вже після перезапуску сервера, коли тих
    // предметів давно немає. Заразом це відповідає на «а що як модуль вийняли посеред роботи».
    float m_ZP_CyclePurity;      // що записати у вироблений зразок
    float m_ZP_CycleChanceMul;   // на що помножити шанс (1.0, якщо вхід не ніс чистоти)
    ref Timer m_ZP_PollTimer;

    // Реєстр УСІХ живих приладів, а не лише статиків: скидання фракції має зупиняти й
    // переносні станції, інакше запущена до скидання станція доробить і заллє бали в
    // щойно обнулений пул. (s_ZP_Statics нижче лишається для списків/спавнера статиків.)
    static ref array<ZP_Device_Base> s_ZP_Devices = new array<ZP_Device_Base>();

    void ZP_Device_Base()
    {
        // реєстрація ЛИШЕ в конструкторі — пізніша мовчки не працює
        RegisterNetSyncVariableInt("m_ZP_State", 0, 2);
    }

    void ~ZP_Device_Base()
    {
        ZP_StopTimer();
        if (GetGame())
        {
            GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).Remove(ZP_ResumeAfterLoad);
            // і автопродовження теж: воно ставиться в чергу на +1 с після кожного циклу,
            // і в це вікно прилад може зникнути (адмін зніс статик, CE прибрала переносний,
            // гравець від'єднався з ним у рюкзаку). Асиметрія тут = виклик на мертвий об'єкт.
            GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).Remove(ZP_TryAutoContinue);
        }
    }

    override void EEInit()
    {
        super.EEInit();
        if (GetGame().IsDedicatedServer())
        {
            if (s_ZP_Devices.Find(this) < 0)
                s_ZP_Devices.Insert(this);
            // ПОЧАТКОВИЙ ПУШ СТАНУ. Без нього клієнт судить про щойно завантажений прилад
            // за неініціалізованим значенням нетсинк-змінної: сервер позначає її брудною
            // лише при старті, скиданні й відновленні, а статик у ВІЛЬНОМУ стані не
            // проходить жодну з цих точок. Наслідок був такий: після запуску сервера
            // підказка F на приладі не з'являлась і оживала аж після першої команди
            // запуску — саме вона робила перший SetSynchDirty.
            SetSynchDirty();
        }
    }

    override void EEDelete(EntityAI parent)
    {
        ZP_StopTimer();
        int di = s_ZP_Devices.Find(this);
        if (di > -1)
            s_ZP_Devices.Remove(di);
        if (GetGame())
        {
            GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).Remove(ZP_ResumeAfterLoad);
            GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).Remove(ZP_TryAutoContinue);
        }
        super.EEDelete(parent);
    }

    string ZP_GetStarterFaction()
    {
        return m_ZP_StarterFaction;
    }

    int ZP_GetState()
    {
        return m_ZP_State;
    }

    // «Зайнята» = працює або стоїть із недоданим виходом
    bool ZP_IsBusy()
    {
        return m_ZP_State == ZP_STATE_RUNNING || m_ZP_State == ZP_STATE_DONE;
    }

    // Чи є що забрати: предмети, яким не знайшлося місця в карго
    bool ZP_HasPending()
    {
        return m_ZP_PendingItems.Count() > 0;
    }

    // ЖОДНОГО блокування карго тут немає — і це принципово.
    //
    // Було: CanReceiveItemIntoCargo повертав false при RUNNING. Блокування дісталося
    // від старої схеми, де сировину списували НАПРИКІНЦІ роботи і її треба було заморозити;
    // відколи вхід споживається ПРИ СТАРТІ, заморожувати нічого. Натомість воно робило дві
    // шкоди:
    //   1) ZP_Complete спавнив вихід, поки стан ще RUNNING, — станція забороняла приймання
    //      сама собі, тож КОЖЕН вихід фонової станції летів на землю навіть у порожнє карго;
    //   2) ванільний itembase.c:4193 прямо застерігає: Bohemia вимкнула власну перевірку в
    //      цьому ж хуку з поміткою «loading from storage -> after load items in cargo was
    //      lost». Станція вантажиться зі сховища саме в робочому стані, тож заборона в хуку
    //      загрожувала вмісту карго при кожному перезапуску.
    // Тому обидва хуки приймання/віддавання карго лишаються ванільними.

    // ЧУЖИЙ ІНСТРУМЕНТ У ЦЕЙ ПРИЛАД НЕ ВСТАВЛЯЄТЬСЯ (директива власника: інструменти не
    // універсальні, у кожного приладу свої). Перелік — у Modules.json, тобто пари
    // «інструмент — прилад» правляться на живому сервері, а не заморожені в config.cpp.
    //
    // Перекриваємо САМЕ CanReceiveAttachment (шлях РУЧНОЇ вставки) і НЕ чіпаємо
    // CanLoadAttachment: за ванільним коментарем (entityai.c:1455) саме останній рушій
    // смикає при завантаженні зі сховища, і відмова там позбавила б прилад уже вставленого
    // інструмента після кожного перезапуску.
    override bool CanReceiveAttachment(EntityAI attachment, int slotId)
    {
        if (attachment && ZP_ConfigService.s_Instance)
        {
            ZP_ModulesConfig mods = ZP_ConfigService.Get().GetModules();
            if (mods && !mods.AllowedOn(attachment.GetType(), GetType()))
                return false;
        }
        return super.CanReceiveAttachment(attachment, slotId);
    }

    // ІНСТРУМЕНТ, ПОТРІБНИЙ ПРАВИЛУ, НЕ ВИЙМАЄТЬСЯ, ПОКИ ЙДЕ РОБОТА.
    //
    // Обрано блокування, а не зупинку роботи: сировину списано ще при старті, тож зупинка
    // означала б тиху втрату матеріалу через випадкове перетягування. Блокування нічого не
    // губить і не потребує пояснень — предмет просто не виймається.
    //
    // Це безпечно щодо завантаження зі сховища — як і заборона вище. УТОЧНЕННЯ ФАКТУ:
    // раніше тут стояло, що рушій смикає при завантаженні саме CanReceive*. Це НЕ ТАК.
    // Ванільні doc-коментарі однозначні: «is called on server start when loading in the
    // storage» стоїть у CanLoadAttachment (entityai.c:1455-1461) і CanLoadItemIntoCargo
    // (entityai.c:1567-1573), а CanReceiveAttachment / CanReceiveItemIntoCargo описані
    // просто як умови дій. Замки карго ми зняли з ІНШОЇ, справжньої причини: станція
    // забороняла приймання сама собі й кожен вихід летів на землю.
    //
    // Блокуємо ТОЧКОВО: лише ті інструменти, яких вимагає правило, що ЗАРАЗ виконується.
    // Решта вкладень виймається вільно. Якщо правило зникло з конфігу — не блокуємо взагалі,
    // інакше інструмент лишився б замкненим назавжди.
    override bool CanReleaseAttachment(EntityAI attachment)
    {
        if (m_ZP_State == ZP_STATE_RUNNING && attachment && ZP_ConfigService.s_Instance)
        {
            ZP_Rule running = ZP_ConfigService.Get().GetRules().FindById(m_ZP_RuleId);
            if (running)
            {
                foreach (string req : running.RequiredTools)
                {
                    if (ZP_ProcessingRules.MatchClass(attachment.GetType(), req))
                        return false;
                }
            }
        }
        return super.CanReleaseAttachment(attachment);
    }

    // Станцію не можна підбирати, поки вона зайнята: у чужому контейнері спавн у її карго
    // не працює, тож результат нікуди було б видати (модель M5 — прилади стаціонарні).
    override bool CanPutInCargo(EntityAI parent)
    {
        if (ZP_IsBusy())
            return false;
        return super.CanPutInCargo(parent);
    }

    override bool CanPutIntoHands(EntityAI parent)
    {
        if (ZP_IsBusy())
            return false;
        return super.CanPutIntoHands(parent);
    }

    // Таймер планується на ЗАЛИШОК часу, а не тікає раз на 5 секунд: дедлайн відомий
    // наперед, тож для 4-годинного процесу було 2880 тіків, з яких корисний рівно один.
    // Стеля в хвилину лишає точку перевірки для крайових випадків (правило вимкнули,
    // конфіг ще не завантажився), підлога в секунду боронить від нульового інтервалу.
    protected void ZP_StartTimer()
    {
        if (!m_ZP_PollTimer)
            m_ZP_PollTimer = new Timer(CALL_CATEGORY_SYSTEM);
        if (m_ZP_PollTimer.IsRunning())
            m_ZP_PollTimer.Stop();
        int left = m_ZP_EndSec - ZP_Now.EpochSec();
        if (left < 1)
            left = 1;
        if (left > 60)
            left = 60;
        m_ZP_PollTimer.Run(left, this, "ZP_Poll", null, true);
    }

    protected void ZP_StopTimer()
    {
        if (m_ZP_PollTimer)
            m_ZP_PollTimer.Stop();
    }

    // SERVER: запуск фонового процесу за правилом, знайденим у карго
    bool ZP_StartStation(PlayerBase player, out string msg)
    {
        msg = "";
        if (!GetGame().IsDedicatedServer())
        {
            msg = "лише сервер";
            return false;
        }
        if (m_ZP_State == ZP_STATE_DONE)
        {
            msg = "у приладі лежить готовий результат — спершу заберіть його";
            return false;
        }
        if (m_ZP_State != ZP_STATE_IDLE)
        {
            msg = "станція вже працює";
            return false;
        }
        if (!player || !player.GetIdentity())
        {
            msg = "немає identity";
            return false;
        }
        string ownFc = ZP_Factions.GetFactionClass(player);
        if (!ZP_ConfigService.Get().IsDeviceFor(ownFc, GetType()))
        {
            msg = "прилад " + GetType() + " не належить фракції " + ownFc;
            return false;
        }
        string findErr;
        ZP_Rule rule = ZP_Processing.FindStartableBackgroundRule(this, player, findErr);
        if (!rule)
        {
            msg = findErr;
            return false;
        }
        string uid = player.GetIdentity().GetPlainId();
        int nowSec = ZP_Now.EpochSec();
        // Сировина зникає з карго ПРИ СТАРТІ, і лише потім починається робота (рішення
        // власника): гравець бачить, що прилад узяв матеріал і працює. Наслідок — скасування
        // або вимкнення правила адміном сировину НЕ повертає, вона вже спожита.
        ref array<ItemBase> inItems = new array<ItemBase>();
        ref array<int> inAmounts = new array<int>();
        ref array<int> inInputs = new array<int>();
        string inErr;
        if (!ZP_Processing.BuildCargoPlan(this, rule, inItems, inAmounts, inInputs, inErr))
        {
            msg = inErr;
            return false;
        }
        // чистоту знімаємо ДО списання: після ConsumePlan предметів уже немає
        ZP_FreezeCyclePurity(rule, inItems, inInputs);
        ZP_Processing.ConsumePlan(inItems, inAmounts);
        m_ZP_RuleId = rule.Id;
        m_ZP_StarterUid = uid;
        m_ZP_StarterFaction = ZP_Factions.GetFactionClass(player);
        float startTime = ZP_ProcessingRules.EffectiveTimeSec(rule.TimeSec);
        m_ZP_EndSec = nowSec + startTime;
        m_ZP_State = ZP_STATE_RUNNING;
        SetSynchDirty();
        ZP_StartTimer();
        msg = "запущено: '" + rule.Id + "', ~" + startTime + " с";
        ZP_Log.Dbg("station " + GetType() + " started rule '" + rule.Id + "' by " + uid + ", end=" + m_ZP_EndSec);
        return true;
    }

    // Знімок чистоти на початку циклу. ОБИДВА шляхи старту — ручний запуск і автопродовження —
    // зобов'язані його зробити: автоцикл без цього поїхав би на чистоті минулої партії.
    protected void ZP_FreezeCyclePurity(ZP_Rule rule, array<ItemBase> inItems, array<int> inInputs)
    {
        float quality = ZP_Processing.PlanQuality(inItems, inInputs);
        m_ZP_CyclePurity = ZP_Processing.ComputeOutPurity(rule, this, quality);
        m_ZP_CycleChanceMul = 1.0;
        if (ZP_Processing.PlanHasSample(inItems, inInputs))
            m_ZP_CycleChanceMul = quality;   // вхід ніс чистоту — саме тут вона й витрачається
        ZP_Log.Dbg("station " + GetType() + " '" + rule.Id + "': якість входу=" + quality + " чистота виходу=" + m_ZP_CyclePurity + " множник шансу=" + m_ZP_CycleChanceMul);
    }

    void ZP_Poll()
    {
        // вікно in-process перезапуску місії: OnMissionFinish обнуляє сервіс, а SYSTEM-черга
        // таймерів тікає безумовно (dayzgame.c) — пропускаємо тік до реініціалізації
        if (!ZP_ConfigService.s_Instance)
            return;
        if (m_ZP_State != ZP_STATE_RUNNING)
        {
            ZP_StopTimer();
            return;
        }
        if (ZP_Now.EpochSec() >= m_ZP_EndSec)
            ZP_Complete();
    }

    protected void ZP_Complete()
    {
        ZP_StopTimer();
        // revision==0 = сервіс створено ліниво, але ServerLoad ще не пройшов (правила порожні) —
        // не скасовувати легітимний процес, повторити на наступному тіку
        if (ZP_ConfigService.Get().GetRevision() == 0)
        {
            ZP_Log.Warn("station " + GetType() + ": конфіг ще не завантажено, завершення відкладено");
            ZP_StartTimer();
            return;
        }
        ZP_Rule rule = ZP_ConfigService.Get().GetRules().FindById(m_ZP_RuleId);
        if (!rule)
        {
            ZP_Cancel("правило '" + m_ZP_RuleId + "' зникло з конфігу");
            return;
        }
        // екстрене вимкнення правила адміном зупиняє й працюючі станції
        // (refund-семантика; при lose_input вхідні предмети вже втрачено — узгоджено з політикою)
        if (!rule.Enabled)
        {
            ZP_Cancel("правило вимкнено адміном");
            return;
        }
        // Сировину вже списано при старті. Тут цикл ЗАКІНЧУЄТЬСЯ: розігруються шанси
        // (рівно один раз на цикл) і вихід ОДРАЗУ викладається в карго приладу.
        // Балів прилад не дає взагалі — їх принесе здача носія на терміналі.
        ref array<string> cycleItems = new array<string>();
        ref array<string> cycleContents = new array<string>();
        ZP_Processing.ResolveResult(rule, m_ZP_CycleChanceMul, cycleItems, cycleContents);

        // вироблене цим циклом — щоб автопродовження не взяло власний вихід за сировину
        // (пара «клас + вміст», інакше пакувальник заблокував би всі зразки взагалі)
        ref array<string> producedCls = new array<string>();
        ref array<string> producedCnt = new array<string>();
        int placed = 0;
        while (cycleItems.Count() > 0)
        {
            string cls = cycleItems[0];
            string cnt = cycleContents[0];
            if (!ZP_Processing.SpawnOneToCargo(this, cls, cnt, m_ZP_CyclePurity))
                break;
            producedCls.Insert(cls);
            producedCnt.Insert(cnt);
            cycleItems.RemoveOrdered(0);
            cycleContents.RemoveOrdered(0);
            placed++;
        }
        // що не вмістилось — лягає в сховище, а НЕ на підлогу
        int stuck = cycleItems.Count();
        for (int s = 0; s < stuck; s++)
        {
            m_ZP_PendingItems.Insert(cycleItems[s]);
            m_ZP_PendingContents.Insert(cycleContents[s]);
            m_ZP_PendingPurities.Insert(m_ZP_CyclePurity);
        }

        ZP_Log.Dbg("station " + GetType() + " cycle '" + rule.Id + "': викладено=" + placed + " застрягло=" + stuck + " starter=" + m_ZP_StarterUid);

        // Виключення озброюємо ДО перевірки на застрягання: інакше на шляху «карго повне»
        // вони лишалися б порожніми, і конвеєр, відновлений забором результату, узяв би
        // власний щойно викладений вихід за сировину.
        m_ZP_AutoExcludeCls = producedCls;
        m_ZP_AutoExcludeCnt = producedCnt;

        if (stuck > 0)
        {
            // конвеєр стає: складати нікуди, поки не звільнять місце
            m_ZP_State = ZP_STATE_DONE;
            SetSynchDirty();
            ZP_Log.Warn("station " + GetType() + ": карго заповнене, конвеєр зупинено (незакладених предметів " + stuck + ")");
            return;
        }

        // Наступний цикл — НЕ в цьому кадрі: ObjectDelete у рушії відкладено до кінця кадру
        // (перевірено зондами в M2a), тож негайне пересканування карго побачило б щойно
        // спожиту сировину і порахувало б її вдруге.
        m_ZP_State = ZP_STATE_IDLE;
        SetSynchDirty();
        GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).CallLater(ZP_TryAutoContinue, 1000, false);
    }

    ref array<string> m_ZP_AutoExcludeCls;
    ref array<string> m_ZP_AutoExcludeCnt;

    // Автопродовження: поки в карго лишається придатна сировина, станція бере наступну
    // партію сама. Гравця немає — гейт правила йде за ЗАМОРОЖЕНОЮ фракцією стартувальника,
    // і бали й далі течуть у той самий пул.
    void ZP_TryAutoContinue()
    {
        if (!GetGame() || !GetGame().IsDedicatedServer())
            return;
        if (!ZP_ConfigService.s_Instance)
            return;
        if (m_ZP_State != ZP_STATE_IDLE)
            return;
        if (IsDamageDestroyed())
            return;
        string faction = m_ZP_StarterFaction;
        if (faction == "")
            faction = ZP_ConfigService.Get().GetSettings().DefaultFaction;
        string findErr;
        ZP_Rule next = ZP_Processing.FindAutoContinueRule(this, faction, m_ZP_AutoExcludeCls, m_ZP_AutoExcludeCnt, findErr);
        if (!next)
        {
            ZP_Log.Dbg("station " + GetType() + ": конвеєр став — " + findErr);
            m_ZP_AutoExcludeCls = null;
            m_ZP_AutoExcludeCnt = null;
            return;
        }
        ref array<ItemBase> inItems = new array<ItemBase>();
        ref array<int> inAmounts = new array<int>();
        ref array<int> inInputs = new array<int>();
        string inErr;
        if (!ZP_Processing.BuildCargoPlan(this, next, inItems, inAmounts, inInputs, inErr))
        {
            ZP_Log.Dbg("station " + GetType() + ": конвеєр став — " + inErr);
            m_ZP_AutoExcludeCls = null;
            m_ZP_AutoExcludeCnt = null;
            return;
        }
        // автопродовження — ДРУГИЙ незалежний шлях старту: без власного знімка чистоти
        // автоцикл поїхав би на числах минулої партії
        ZP_FreezeCyclePurity(next, inItems, inInputs);
        ZP_Processing.ConsumePlan(inItems, inAmounts);
        m_ZP_RuleId = next.Id;
        m_ZP_EndSec = ZP_Now.EpochSec() + ZP_ProcessingRules.EffectiveTimeSec(next.TimeSec);
        m_ZP_State = ZP_STATE_RUNNING;
        SetSynchDirty();
        ZP_StartTimer();
        ZP_Log.Dbg("station " + GetType() + " авто-цикл '" + next.Id + "', end=" + m_ZP_EndSec);
    }

    // Три паралельні масиви незакладеного результату пишуться, читаються й скорочуються
    // разом, тож довжини мусять збігатися. Але тихий вихід за межу впав би посеред видачі
    // результату або посеред збереження, тому вирівнюємо явно й голосно — і робимо це в
    // ОДНОМУ місці, яке кличуть обидва шляхи (видача і запис у сховище).
    protected void ZP_AlignPending()
    {
        while (m_ZP_PendingContents.Count() < m_ZP_PendingItems.Count())
        {
            ZP_Log.Warn("station " + GetType() + ": перелік вмісту коротший за перелік предметів — доповнено порожнім");
            m_ZP_PendingContents.Insert("");
        }
        while (m_ZP_PendingPurities.Count() < m_ZP_PendingItems.Count())
        {
            ZP_Log.Warn("station " + GetType() + ": перелік чистоти коротший за перелік предметів — доповнено нулем");
            m_ZP_PendingPurities.Insert(0);
        }
    }

    // SERVER: дозакласти в карго те, що не вмістилось, і знову запустити конвеєр.
    // Штатно тут порожньо — вихід викладається сам одразу після циклу; ця дія потрібна,
    // коли карго було заповнене і станція стала.
    bool ZP_CollectResult(PlayerBase player, out string msg)
    {
        msg = "";
        if (!GetGame().IsDedicatedServer())
        {
            msg = "лише сервер";
            return false;
        }
        if (m_ZP_PendingItems.Count() == 0)
        {
            msg = "у приладі немає незакладеного результату";
            return false;
        }
        int handed = 0;
        int dropped = 0;
        // Довжини масивів мусять збігатися — вони пишуться, читаються й скорочуються разом.
        // Але якщо колись розійдуться, тихий вихід за межу впав би посеред видачі результату,
        // тож вирівнюємо явно й голосно.
        ZP_AlignPending();
        while (m_ZP_PendingItems.Count() > 0)
        {
            string cls = m_ZP_PendingItems[0];
            // КЛАС МІГ ЗНИКНУТИ. Залишок лежить у сховищі роками, а мод, що давав цей клас,
            // адмін може зняти або перейменувати. Без цієї перевірки спавн вічно повертав би
            // NULL, станція назавжди лишалася б у стані ЗУПИНЕНО, і конвеєр більше ніколи не
            // пішов би — причому мовчки, бо ззовні це не відрізнити від «карго повне».
            // Викидаємо запис і йдемо далі: втрачений предмет усе одно неможливо створити.
            if (!ZP_ProcessingRules.ClassExists(cls))
            {
                ZP_Log.Warn("station " + GetType() + ": клас '" + cls + "' зник із гри — запис викинуто з незакладеного результату");
                m_ZP_PendingItems.RemoveOrdered(0);
                m_ZP_PendingContents.RemoveOrdered(0);
                m_ZP_PendingPurities.RemoveOrdered(0);
                dropped++;
                continue;
            }
            if (!ZP_Processing.SpawnOneToCargo(this, cls, m_ZP_PendingContents[0], m_ZP_PendingPurities[0]))
                break;
            // те, що ЩОЙНО лягло в карго, теж не має піти в роботу як сировина
            if (!m_ZP_AutoExcludeCls)
            {
                m_ZP_AutoExcludeCls = new array<string>();
                m_ZP_AutoExcludeCnt = new array<string>();
            }
            m_ZP_AutoExcludeCls.Insert(cls);
            m_ZP_AutoExcludeCnt.Insert(m_ZP_PendingContents[0]);
            m_ZP_PendingItems.RemoveOrdered(0);
            m_ZP_PendingContents.RemoveOrdered(0);
            m_ZP_PendingPurities.RemoveOrdered(0);
            handed++;
        }
        int left = m_ZP_PendingItems.Count();
        if (left > 0)
        {
            msg = "закладено " + handed + ", лишилось " + left + " — місця в приладі все ще бракує";
            if (dropped > 0)
                msg = msg + "; записів із втраченими класами викинуто: " + dropped;
            ZP_Log.Dbg("station " + GetType() + " collect: частково, закладено=" + handed + " лишилось=" + left);
            return true;
        }
        // місце звільнилось — конвеєр можна вести далі
        m_ZP_State = ZP_STATE_IDLE;
        SetSynchDirty();
        msg = "закладено предметів: " + handed;
        if (dropped > 0)
            msg = msg + "; записів із втраченими класами викинуто: " + dropped;
        ZP_Log.Dbg("station " + GetType() + " collect: закладено=" + handed + ", конвеєр відновлено");
        GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).CallLater(ZP_TryAutoContinue, 1000, false);
        return true;
    }

    protected void ZP_Cancel(string reason)
    {
        ZP_StopTimer();
        ZP_Log.Warn("station " + GetType() + " rule '" + m_ZP_RuleId + "' скасовано: " + reason);
        ZP_ResetState();
    }

    protected void ZP_ResetState()
    {
        m_ZP_State = ZP_STATE_IDLE;
        m_ZP_RuleId = "";
        m_ZP_EndSec = 0;
        m_ZP_StarterUid = "";
        m_ZP_StarterFaction = "";
        m_ZP_PendingItems.Clear();
        m_ZP_PendingContents.Clear();
        m_ZP_PendingPurities.Clear();
        m_ZP_CyclePurity = 0;
        m_ZP_CycleChanceMul = 1.0;
        SetSynchDirty();
    }

    // публічне скасування для адмін-команди (!zp cancelstation): refund-логіка вже в ZP_Cancel
    bool ZP_AdminCancel(string reason, out string msg)
    {
        msg = "";
        if (!GetGame().IsDedicatedServer())
        {
            msg = "лише сервер";
            return false;
        }
        if (!ZP_IsBusy())
        {
            msg = "станція вільна";
            return false;
        }
        string rid = m_ZP_RuleId;
        // ГОТОВО скасовується теж — інакше незабраний результат неможливо було б прибрати
        // (це потрібно скиданню фракції: інакше бали зі снапшота потрапили б у щойно обнулений пул)
        bool wasDone = m_ZP_State == ZP_STATE_DONE;
        ZP_Cancel(reason);
        if (wasDone)
        {
            msg = "скасовано: незабраний результат '" + rid + "' знищено";
            return true;
        }
        msg = "скасовано: '" + rid + "' (сировину було спожито при старті — вона не повертається)";
        return true;
    }

    // ---- персистентність станції (CF_ModStorage; storageVersion=1 у CfgMods) ----

    override void CF_OnStoreSave(CF_ModStorageMap storage)
    {
        super.CF_OnStoreSave(storage);
        auto ctx = storage["ZP_Research"];
        if (!ctx)
            return;
        ZP_AlignPending();   // у потік мусить піти рівно itemCount значень кожного виду
        ctx.Write(m_ZP_State);
        ctx.Write(m_ZP_RuleId);
        ctx.Write(m_ZP_EndSec);
        ctx.Write(m_ZP_StarterUid);
        ctx.Write(m_ZP_StarterFaction);   // v2 — лише в кінець потоку
        // v5: незакладений вихід. Масив пишемо як кількість + елементи (CF не серіалізує
        // контейнери сам). Саме це робить залишок стійким до перезапуску: він лежить
        // записом у сховищі, а не предметами у світі.
        int itemCount = m_ZP_PendingItems.Count();
        ctx.Write(itemCount);
        for (int i = 0; i < itemCount; i++)
            ctx.Write(m_ZP_PendingItems[i]);
        // v6: вміст незакладених зразків. Дописано В КІНЕЦЬ потоку — записи CF позиційні,
        // тож будь-яка зміна, крім дописування, вимагала б гейта за ctx.GetVersion().
        for (int j = 0; j < itemCount; j++)
            ctx.Write(m_ZP_PendingContents[j]);
        // v7: заморожена чистота циклу + чистота незакладених зразків. Знову ДОПИСУЄМО в
        // кінець: записи CF позиційні, тож будь-яка інша зміна вимагала б гейта за версією.
        ctx.Write(m_ZP_CyclePurity);
        ctx.Write(m_ZP_CycleChanceMul);
        for (int k2 = 0; k2 < itemCount; k2++)
            ctx.Write(m_ZP_PendingPurities[k2]);
    }

    // скидання полів БЕЗ SetSynchDirty — для збоїв завантаження (нетсинк ще не активний)
    protected void ZP_ClearStateRaw()
    {
        m_ZP_State = ZP_STATE_IDLE;
        m_ZP_RuleId = "";
        m_ZP_EndSec = 0;
        m_ZP_StarterUid = "";
        m_ZP_StarterFaction = "";
        m_ZP_PendingItems.Clear();
        m_ZP_PendingContents.Clear();
        m_ZP_PendingPurities.Clear();
        m_ZP_CyclePurity = 0;
        m_ZP_CycleChanceMul = 1.0;
    }

    override bool CF_OnStoreLoad(CF_ModStorageMap storage)
    {
        if (!super.CF_OnStoreLoad(storage))
            return false;
        auto ctx = storage["ZP_Research"];
        if (!ctx)
            return true;   // сейв старіший за мод/перше збереження (CF пише лише моди з даними)
        // пошкоджений/обірваний substream: CF на false НЕ видаляє сутність (лише warning) —
        // без скидання станція лишилася б назавжди RUNNING із заблокованим карго
        if (!ctx.Read(m_ZP_State))
        {
            ZP_ClearStateRaw();
            return false;
        }
        if (!ctx.Read(m_ZP_RuleId))
        {
            ZP_ClearStateRaw();
            return false;
        }
        if (!ctx.Read(m_ZP_EndSec))
        {
            ZP_ClearStateRaw();
            return false;
        }
        if (!ctx.Read(m_ZP_StarterUid))
        {
            ZP_ClearStateRaw();
            return false;
        }
        if (!ctx.Read(m_ZP_StarterFaction))
        {
            ZP_ClearStateRaw();
            return false;
        }
        // v5: незакладений вихід
        m_ZP_PendingItems.Clear();
        m_ZP_PendingContents.Clear();
        int itemCount;
        if (!ctx.Read(itemCount))
        {
            ZP_ClearStateRaw();
            return false;
        }
        string cls;
        for (int i = 0; i < itemCount; i++)
        {
            if (!ctx.Read(cls))
            {
                ZP_ClearStateRaw();
                return false;
            }
            m_ZP_PendingItems.Insert(cls);
        }
        // v6: вміст незакладених зразків. Гейт за ВЕРСІЄЮ ЗАПИСУ (ctx.GetVersion() віддає
        // storageVersion на момент збереження): у потоці v5 цих рядків фізично немає, і
        // спроба їх прочитати з'їла б наступні записи чужих модів.
        string cnt;
        for (int k = 0; k < itemCount; k++)
        {
            cnt = "";
            if (ctx.GetVersion() >= 6 && !ctx.Read(cnt))
            {
                ZP_ClearStateRaw();
                return false;
            }
            m_ZP_PendingContents.Insert(cnt);
        }
        // v7: чистота. У старішому потоці її фізично немає, і взяти її нізвідки —
        // а нуль тут НЕ нейтральний: зразок вийшов би з чистотою 0 і був би мертвим до
        // кінця ланцюжка (аналіз узяв би його і не видав нічого). Тому цикл зі старого
        // сейву не дограється, а скидається — рівно як цикл, чиє правило зникло з конфігу.
        bool preV7 = ctx.GetVersion() < 7;
        m_ZP_CyclePurity = 0;
        m_ZP_CycleChanceMul = 1.0;
        m_ZP_PendingPurities.Clear();
        if (ctx.GetVersion() >= 7)
        {
            if (!ctx.Read(m_ZP_CyclePurity))
            {
                ZP_ClearStateRaw();
                return false;
            }
            if (!ctx.Read(m_ZP_CycleChanceMul))
            {
                ZP_ClearStateRaw();
                return false;
            }
        }
        float pur;
        for (int k3 = 0; k3 < itemCount; k3++)
        {
            pur = 0;
            if (ctx.GetVersion() >= 7 && !ctx.Read(pur))
            {
                ZP_ClearStateRaw();
                return false;
            }
            m_ZP_PendingPurities.Insert(pur);
        }

        if (preV7 && (m_ZP_State == ZP_STATE_RUNNING || m_ZP_State == ZP_STATE_DONE))
        {
            ZP_Log.Warn("station " + GetType() + ": запис зі сховища старший за v7 — цикл '" + m_ZP_RuleId + "' скинуто (чистоти в ньому немає)");
            ZP_ClearStateRaw();
            return true;
        }
        if (m_ZP_State == ZP_STATE_RUNNING || m_ZP_State == ZP_STATE_DONE)
        {
            if (GetGame().IsDedicatedServer())
            {
                // відкладено: карго і світ мають дозавантажитися; Poll довершить за timestamp
                GetGame().GetCallQueue(CALL_CATEGORY_SYSTEM).CallLater(ZP_ResumeAfterLoad, 2000, false);
            }
            else
            {
                // офлайн-режим (діаг): resume не планується — інакше станція назавжди лишиться
                // зайнятою; скидаємо (сировину спожито при старті, вона не повертається)
                ZP_ClearStateRaw();
            }
        }
        return true;
    }

    void ZP_ResumeAfterLoad()
    {
        // Зупинений конвеєр переживає перезапуск без таймера: залишок лежить у сховищі
        if (m_ZP_State == ZP_STATE_DONE)
        {
            SetSynchDirty();
            ZP_Log.Dbg("station " + GetType() + " restored '" + m_ZP_RuleId + "': конвеєр стоїть, незакладених предметів=" + m_ZP_PendingItems.Count());
            return;
        }
        if (m_ZP_State != ZP_STATE_RUNNING)
            return;
        SetSynchDirty();
        ZP_StartTimer();
        ZP_Log.Dbg("station " + GetType() + " resumed rule '" + m_ZP_RuleId + "', end=" + m_ZP_EndSec);
    }
}

// Польовий набір чашок Петрі — прилад T1 (переносний, action-режим).
class ZP_PetriDishKit : ZP_Device_Base
{
}

// Стаціонарний прилад (M5a, основний тип за директивою): лишається ItemBase — карго/netsync/
// CF-сховище/хайв-персистентність M2b зберігаються, але взяти його не можна НІКОЛИ (безумовно,
// не лише при RUNNING). Канон Bohemia: PowerGeneratorStatic (powergeneratorstatic.c:143-229).
// House/Land_ як носій стану відкинуто — building-side не персиститься (пруф BI там само :64).
class ZP_Device_StaticBase : ZP_Device_Base
{
    // реєстр живих статиків (утиліти/списки; для boot-дедупу НЕ годиться — entity-storage
    // вантажиться ПІСЛЯ MissionServer.OnInit, дедуп спавну робить стейт-файл ZP_StaticSpawner)
    static ref array<ZP_Device_StaticBase> s_ZP_Statics = new array<ZP_Device_StaticBase>();

    override void EEInit()
    {
        super.EEInit();
        if (GetGame().IsDedicatedServer() && s_ZP_Statics.Find(this) < 0)
            s_ZP_Statics.Insert(this);
    }

    override void EEDelete(EntityAI parent)
    {
        int idx = s_ZP_Statics.Find(this);
        if (idx > -1)
            s_ZP_Statics.Remove(idx);
        super.EEDelete(parent);
    }

    override bool IsTakeable()
    {
        return false;
    }

    override bool CanPutIntoHands(EntityAI parent)
    {
        return false;
    }

    override bool CanPutInCargo(EntityAI parent)
    {
        return false;
    }

    override bool CanRemoveFromCargo(EntityAI parent)
    {
        return false;
    }

    // ItemBase з IsTakeable=false ховає віджет прицілу (actiontargetscursor.c:759) —
    // повертаємо показ, інакше екшени станції не видно гравцеві. DisableVicinityIcon
    // НЕ перевизначаємо: доступ до карго — через vicinity-панель.
    override bool IsActionTargetVisible()
    {
        return true;
    }

    static ZP_Device_StaticBase FindNear(string classname, vector pos, float tolerance)
    {
        foreach (ZP_Device_StaticBase dev : s_ZP_Statics)
        {
            if (!dev)
                continue;
            if (classname != "" && dev.GetType() != classname)
                continue;
            if (vector.Distance(dev.GetPosition(), pos) <= tolerance)
                return dev;
        }
        return null;
    }
}

// Мікроскоп — головна станція T2 (СТАТИК з M5a; ім'я класу не змінювати — хайв-сейви живі).
class ZP_Microscope : ZP_Device_StaticBase
{
}

// Науковий комп'ютер — статик-станція обробки даних.
class ZP_LabComputer : ZP_Device_StaticBase
{
}


// Хімічний стенд — статик-станція (лабораторний стіл із раковиною).
class ZP_ChemBench : ZP_Device_StaticBase
{
}

// Серверна стійка — статик-сховище даних досліджень.
class ZP_ServerRack : ZP_Device_StaticBase
{
}

// Холодильник зразків: конфіг-предок RefrigeratorMinsk (карго 2x5), скрипт-предок — наша
// станція (охолодження ванільного скрипт-класу свідомо не успадковуємо; енергія — M5b).
class ZP_SampleFridge : ZP_Device_StaticBase
{
}

// Польовий науковий кейс — портативний виняток (транспортування зразків, T1).
class ZP_FieldCase : ZP_Device_Base
{
}

// ================= СТЕНДОВІ ПРИЛАДИ ФРАКЦІЙ (2026-08-09) =================
//
// Дванадцять станцій: Вчені (Eco) і Чисте небо (Sky) x bio/anomaly/electronics x
// пакувальник (Pack) / переробник (Proc). Тіла порожні — уся поведінка станції живе в
// ZP_Device_StaticBase, а різниця між приладами задається конфігами (модель у config.cpp,
// належність фракції у Factions.json, правила переробки в ProcessingRules).
//
// Кожен клас ПОТРІБЕН окремо, порожній чи ні: рушій шукає скрипт-клас, піднімаючись
// КОНФІГ-ієрархією, а конфіг-предок ZP_StaticDevice_Base скрипт-двійника не має — без
// цих оголошень прилад мовчки став би звичайним ItemBase (ані карго-логіки, ані дій).
class ZP_Eco_Pack_Bio : ZP_Device_StaticBase
{
}

class ZP_Eco_Proc_Bio : ZP_Device_StaticBase
{
}

class ZP_Eco_Pack_Anom : ZP_Device_StaticBase
{
}

class ZP_Eco_Proc_Anom : ZP_Device_StaticBase
{
}

class ZP_Eco_Pack_Electro : ZP_Device_StaticBase
{
}

class ZP_Eco_Proc_Electro : ZP_Device_StaticBase
{
}

class ZP_Sky_Pack_Bio : ZP_Device_StaticBase
{
}

class ZP_Sky_Proc_Bio : ZP_Device_StaticBase
{
}

class ZP_Sky_Pack_Anom : ZP_Device_StaticBase
{
}

class ZP_Sky_Proc_Anom : ZP_Device_StaticBase
{
}

class ZP_Sky_Pack_Electro : ZP_Device_StaticBase
{
}

class ZP_Sky_Proc_Electro : ZP_Device_StaticBase
{
}
