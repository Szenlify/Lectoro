"use strict";

const fs = require("node:fs");
const path = require("node:path");

const starterData = {
    time: {
        en_def: "The indefinite continued progress of existence and events.",
        s: ["period", "moment"],
        ex: [
            "I do not have enough time today.",
            "What time is the meeting?",
            "Time flies when you are having fun."
        ],
        translations: {
            pl: { t: "czas", def: "Ciągły upływ chwil i zdarzeń.", ex: ["Nie mam dzisiaj wystarczająco dużo czasu.", "O której godzinie jest spotkanie?", "Czas leci szybko, kiedy dobrze się bawisz."] },
            de: { t: "Zeit", def: "Das kontinuierliche Fortschreiten von Augenblicken und Ereignissen.", ex: ["Ich habe heute nicht genug Zeit.", "Um wie viel Uhr ist das Treffen?", "Die Zeit vergeht wie im Flug, wenn man Spaß hat."] },
            es: { t: "tiempo", def: "El transcurso continuo de momentos y acontecimientos.", ex: ["No tengo suficiente tiempo hoy.", "¿A qué hora es la reunión?", "El tiempo vuela cuando te estás divirtiendo."] },
            fr: { t: "temps", def: "L'écoulement continu des moments et des événements.", ex: ["Je n'ai pas assez de temps aujourd'hui.", "À quelle heure est la réunion ?", "Le temps passe vite quand on s'amuse."] },
            it: { t: "tempo", def: "Il continuo scorrere dei momenti e degli eventi.", ex: ["Non ho abbastanza tempo oggi.", "A che ora è la riunione?", "Il tempo vola quando ci si diverte."] },
            cs: { t: "čas", def: "Neustálý běh okamžiků a událostí.", ex: ["Dnes nemám dost času.", "V kolik hodin je schůzka?", "Čas letí, když se bavíte."] },
            ja: { t: "時間", def: "出来事や存在が連続して経過すること。", ex: ["今日は十分な時間がありません。", "会議は何時ですか？", "楽しんでいると時間はあっという間に過ぎます。"] },
            ko: { t: "시간", def: "사건이나 존재가 연속하여 흘러가는 것.", ex: ["오늘은 시간이 충분하지 않아요.", "회의가 몇 시인가요?", "즐거울 때는 시간이 빨리 갑니다."] },
            nl: { t: "tijd", def: "Het voortdurende verloop van momenten en gebeurtenissen.", ex: ["Ik heb vandaag niet genoeg tijd.", "Hoe laat is de vergadering?", "De tijd vliegt als je plezier hebt."] },
            pt: { t: "tempo", def: "O curso contínuo de momentos e acontecimentos.", ex: ["Eu não tenho tempo suficiente hoje.", "A que horas é a reunião?", "O tempo voa quando nos divertimos."] }
        }
    },
    person: {
        en_def: "A human being regarded as an individual.",
        s: ["individual", "human"],
        ex: [
            "She is a kind person.",
            "Only one person was in the room.",
            "Each person must show an ID."
        ],
        translations: {
            pl: { t: "osoba", def: "Człowiek postrzegany jako jednostka.", ex: ["Ona jest życzliwą osobą.", "W pokoju była tylko jedna osoba.", "Każda osoba musi okazać dokument tożsamości."] },
            de: { t: "Person", def: "Ein Mensch als einzelnes Individuum.", ex: ["Sie ist eine freundliche Person.", "Nur eine Person war im Raum.", "Jede Person muss einen Ausweis vorzeigen."] },
            es: { t: "persona", def: "Un ser humano considerado como individuo.", ex: ["Ella es una persona amable.", "Solo una persona estaba en la habitación.", "Cada persona debe mostrar una identificación."] },
            fr: { t: "personne", def: "Un être humain considéré comme un individu.", ex: ["C'est une personne gentille.", "Une seule personne était dans la pièce.", "Chaque personne doit présenter une pièce d'identité."] },
            it: { t: "persona", def: "Un essere umano considerato come individuo.", ex: ["È una persona gentile.", "C'era solo una persona nella stanza.", "Ogni persona deve mostrare un documento."] },
            cs: { t: "osoba", def: "Lidská bytost vnímaná jako jednotlivec.", ex: ["Ona je milá osoba.", "V místnosti byla jen jedna osoba.", "Každá osoba musí předložit průkaz totožnosti."] },
            ja: { t: "人", def: "個人としての人間。", ex: ["彼女は親切な人です。", "部屋には一人しかいませんでした。", "各人が身分証明書を提示しなければなりません。"] },
            ko: { t: "사람", def: "개인으로서의 인간.", ex: ["그녀는 친절한 사람입니다.", "방에는 단 한 사람만 있었습니다.", "각 사람은 신분증을 제시해야 합니다."] },
            nl: { t: "persoon", def: "Een mens beschouwd als individu.", ex: ["Zij is een aardig persoon.", "Er was slechts één persoon in de kamer.", "Elk persoon moet een identiteitsbewijs tonen."] },
            pt: { t: "pessoa", def: "Um ser humano considerado como indivíduo.", ex: ["Ela é uma pessoa gentil.", "Havia apenas uma pessoa na sala.", "Cada pessoa deve mostrar um documento."] }
        }
    },
    year: {
        en_def: "A period of 365 or 366 days.",
        s: ["twelvemonth"],
        ex: [
            "We moved here last year.",
            "The project will finish next year.",
            "It takes a year to train for this."
        ],
        translations: {
            pl: { t: "rok", def: "Okres 365 lub 366 dni.", ex: ["Przeprowadziliśmy się tutaj w zeszłym roku.", "Projekt zakończy się w przyszłym roku.", "Przygotowanie do tego zajmuje rok."] },
            de: { t: "Jahr", def: "Ein Zeitraum von 365 oder 366 Tagen.", ex: ["Wir sind letztes Jahr hierher gezogen.", "Das Projekt wird nächstes Jahr fertig.", "Das Training dafür dauert ein Jahr."] },
            es: { t: "año", def: "Un período de 365 o 366 días.", ex: ["Nos mudamos aquí el año pasado.", "El proyecto terminará el próximo año.", "Se necesita un año para prepararse para esto."] },
            fr: { t: "année", def: "Une période de 365 ou 366 jours.", ex: ["Nous avons emménagé ici l'année dernière.", "Le projet se terminera l'année prochaine.", "Il faut un an d'entraînement pour cela."] },
            it: { t: "anno", def: "Un periodo di 365 o 366 giorni.", ex: ["Ci siamo trasferiti qui l'anno scorso.", "Il progetto terminerà il prossimo anno.", "Ci vuole un anno per prepararsi a questo."] },
            cs: { t: "rok", def: "Období 365 nebo 366 dní.", ex: ["Přestěhovali jsme se sem minulý rok.", "Projekt skončí příští rok.", "Příprava na to trvá jeden rok."] },
            ja: { t: "年", def: "365日または366日の期間。", ex: ["私たちは去年にここへ引っ越してきました。", "プロジェクトは来年完了します。", "これに向けてトレーニングするには1年かかります。"] },
            ko: { t: "년", def: "365일 또는 366일의 기간.", ex: ["우리는 작년에 이곳으로 이사했습니다.", "프로젝트는 내년에 끝납니다.", "이것을 위해 훈련하는 데 1년이 걸립니다."] },
            nl: { t: "jaar", def: "Een periode van 365 of 366 dagen.", ex: ["We zijn vorig jaar hierheen verhuisd.", "Het project zal volgend jaar klaar zijn.", "Het duurt een jaar om hiervoor te trainen."] },
            pt: { t: "ano", def: "Um período de 365 ou 366 dias.", ex: ["Mudámo-nos para cá no ano passado.", "O projeto terminará no próximo ano.", "Leva um ano para treinar para isso."] }
        }
    },
    way: {
        en_def: "A method, style, or manner of doing something.",
        s: ["manner", "method"],
        ex: [
            "There is a better way to solve this.",
            "Can you show me the way to the station?",
            "She did it in her own way."
        ],
        translations: {
            pl: { t: "sposób", def: "Metoda, styl lub droga robienia czegoś.", ex: ["Jest lepszy sposób na rozwiązanie tego.", "Czy możesz mi pokazać drogę na stację?", "Zrobiła to na swój własny sposób."] },
            de: { t: "Weg", def: "Eine Methode, Art und Weise oder Richtung.", ex: ["Es gibt einen besseren Weg, dies zu lösen.", "Können Sie mir den Weg zum Bahnhof zeigen?", "Sie hat es auf ihre eigene Art gemacht."] },
            es: { t: "manera", def: "Un método, estilo o forma de hacer algo.", ex: ["Hay una mejor manera de resolver esto.", "¿Puedes mostrarme el camino a la estación?", "Ella lo hizo a su manera."] },
            fr: { t: "façon", def: "Une méthode, un moyen ou un chemin.", ex: ["Il y a une meilleure façon de résoudre cela.", "Pouvez-vous me montrer le chemin de la gare ?", "Elle l'a fait à sa façon."] },
            it: { t: "modo", def: "Un metodo, stile o via per fare qualcosa.", ex: ["C'è un modo migliore per risolvere questo problema.", "Puoi mostrarmi la strada per la stazione?", "L'ha fatto a modo suo."] },
            cs: { t: "způsob", def: "Metoda, styl nebo cesta, jak něco udělat.", ex: ["Existuje lepší způsob, jak to vyřešit.", "Můžete mi ukázat cestu na nádraží?", "Udělala to po svém."] },
            ja: { t: "方法", def: "何かを行う手段ややり方、道。", ex: ["これを解決するもっと良い方法があります。", "駅への道を教えてもらえますか？", "彼女は自分自身のやり方でそれをやりました。"] },
            ko: { t: "방법", def: "어떤 일을 하는 수단이나 방식 또는 길.", ex: ["이것을 해결할 더 좋은 방법이 있습니다.", "역으로 가는 길을 알려주실 수 있나요?", "그녀는 자신만의 방식으로 그것을 했습니다."] },
            nl: { t: "manier", def: "Een methode, wijze of weg om iets te doen.", ex: ["Er is een betere manier om dit op te lossen.", "Kun je me de weg naar het station wijzen?", "Ze deed het op haar eigen manier."] },
            pt: { t: "maneira", def: "Um método, estilo ou caminho para fazer algo.", ex: ["Há uma maneira melhor de resolver isso.", "Pode me mostrar o caminho para a estação?", "Ela fez isso à sua própria maneira."] }
        }
    },
    day: {
        en_def: "A period of twenty-four hours.",
        s: ["daytime"],
        ex: [
            "It was a sunny day yesterday.",
            "I drink coffee every day.",
            "Have a nice day at work."
        ],
        translations: {
            pl: { t: "dzień", def: "Okres dwudziestu czterech godzin.", ex: ["Wczoraj był słoneczny dzień.", "Piję kawę każdego dnia.", "Miłego dnia w pracy."] },
            de: { t: "Tag", def: "Ein Zeitraum von vierundzwanzig Stunden.", ex: ["Gestern war ein sonniger Tag.", "Ich trinke jeden Tag Kaffee.", "Einen schönen Tag bei der Arbeit."] },
            es: { t: "día", def: "Un período de veinticuatro horas.", ex: ["Ayer fue un día soleado.", "Tomo café todos los días.", "Que tengas un buen día en el trabajo."] },
            fr: { t: "jour", def: "Une période de vingt-quatre heures.", ex: ["Hier était une journée ensoleillée.", "Je bois du café tous les jours.", "Passe une bonne journée au travail."] },
            it: { t: "giorno", def: "Un periodo di ventiquattro ore.", ex: ["Ieri è stata una giornata di sole.", "Bevo caffè ogni giorno.", "Buona giornata al lavoro."] },
            cs: { t: "den", def: "Období dvaceti čtyř hodin.", ex: ["Včera byl slunečný den.", "Každý den piji kávu.", "Hezký den v práci."] },
            ja: { t: "日", def: "24時間の期間、または昼間。", ex: ["昨日は晴れた日でした。", "私は毎日コーヒーを飲みます。", "仕事場で良い一日をお過ごしください。"] },
            ko: { t: "날", def: "24시간의 기간 또는 하루.", ex: ["어제는 화창한 날이었습니다.", "나는 매일 커피를 마십니다.", "직장에서 좋은 하루 되세요."] },
            nl: { t: "dag", def: "Een periode van vierentwintig uur.", ex: ["Het was gisteren een zonnige dag.", "Ik drink elke dag koffie.", "Fijne dag op het werk."] },
            pt: { t: "dia", def: "Um período de vinte e quatro horas.", ex: ["Ontem foi um dia ensolarado.", "Eu tomo café todos os dias.", "Tenha um bom dia no trabalho."] }
        }
    },
    thing: {
        en_def: "An object, item, or entity.",
        s: ["object", "item"],
        ex: [
            "What is that thing on the table?",
            "The best thing to do is wait.",
            "I have one more thing to say."
        ],
        translations: {
            pl: { t: "rzecz", def: "Przedmiot, obiekt lub sprawa.", ex: ["Co to za rzecz na stole?", "Najlepszą rzeczą do zrobienia jest czekanie.", "Mam jeszcze jedną rzecz do powiedzenia."] },
            de: { t: "Ding", def: "Ein Gegenstand, Objekt oder eine Sache.", ex: ["Was ist das für ein Ding auf dem Tisch?", "Das Beste ist abzuwarten.", "Ich habe noch eine Sache zu sagen."] },
            es: { t: "cosa", def: "Un objeto, elemento o asunto.", ex: ["¿Qué es esa cosa en la mesa?", "Lo mejor que se puede hacer es esperar.", "Tengo una cosa más que decir."] },
            fr: { t: "chose", def: "Un objet, un élément ou une entité.", ex: ["Quelle est cette chose sur la table ?", "La meilleure chose à faire est d'attendre.", "J'ai encore une chose à dire."] },
            it: { t: "cosa", def: "Un oggetto, elemento o entità.", ex: ["Cos'è quella cosa sul tavolo?", "La cosa migliore da fare è aspettare.", "Ho un'altra cosa da dire."] },
            cs: { t: "věc", def: "Předmět, objekt nebo záležitost.", ex: ["Co je ta věc na stole?", "Nejlepší věc je počkat.", "Mám ještě jednu věc na srdci."] },
            ja: { t: "物", def: "物体、項目、または事柄。", ex: ["テーブルの上のあの物は何ですか？", "最も良い事は待つことです。", "言いたい事がもう一つあります。"] },
            ko: { t: "것", def: "사물, 대상 또는 일.", ex: ["테이블 위에 있는 저 물건은 무엇인가요?", "가장 좋은 것은 기다리는 것입니다.", "말할 것이 하나 더 있습니다."] },
            nl: { t: "ding", def: "Een voorwerp, object of zaak.", ex: ["Wat is dat ding op de tafel?", "Het beste wat je kunt doen is wachten.", "Ik heb nog één ding te zeggen."] },
            pt: { t: "coisa", def: "Um objeto, item ou entidade.", ex: ["O que é aquela coisa em cima da mesa?", "A melhor coisa a fazer é esperar.", "Tenho mais uma coisa a dizer."] }
        }
    },
    man: {
        en_def: "An adult male human being.",
        s: ["gentleman"],
        ex: [
            "A tall man opened the door.",
            "He is a wise man with great experience.",
            "The man smiled at the children."
        ],
        translations: {
            pl: { t: "mężczyzna", def: "Dorosły człowiek płci męskiej.", ex: ["Wysoki mężczyzna otworzył drzwi.", "To mądry mężczyzna z dużym doświadczeniem.", "Mężczyzna uśmiechnął się do dzieci."] },
            de: { t: "Mann", def: "Ein erwachsener männlicher Mensch.", ex: ["Ein großer Mann öffnete die Tür.", "Er ist ein weiser Mann mit großer Erfahrung.", "Der Mann lächelte die Kinder an."] },
            es: { t: "hombre", def: "Un ser humano adulto de sexo masculino.", ex: ["Un hombre alto abrió la puerta.", "Es un hombre sabio con gran experiencia.", "El hombre sonrió a los niños."] },
            fr: { t: "homme", def: "Un être humain adulte de sexe masculin.", ex: ["Un grand homme a ouvert la porte.", "C'est un homme sage avec une grande expérience.", "L'homme a souri aux enfants."] },
            it: { t: "uomo", def: "Un essere umano adulto maschio.", ex: ["Un uomo alto ha aperto la porta.", "È un uomo saggio con grande esperienza.", "L'uomo ha sorriso ai bambini."] },
            cs: { t: "muž", def: "Dospělý člověk mužského pohlaví.", ex: ["Vysoký muž otevřel dveře.", "Je to moudrý muž s velkými zkušenostmi.", "Muž se usmál na děti."] },
            ja: { t: "男性", def: "大人の人間の男性。", ex: ["背の高い男性がドアを開けました。", "彼は経験豊かな賢い男性です。", "その男性は子供たちに微笑みかけました。"] },
            ko: { t: "남자", def: "성인 남성 인간.", ex: ["키 큰 남자가 문을 열었습니다.", "그는 경험이 많은 현명한 남자입니다.", "그 남자는 아이들에게 미소를 지었습니다."] },
            nl: { t: "man", def: "Een volwassen mannelijk mens.", ex: ["Een lange man opende de deur.", "Hij is een wijze man met veel ervaring.", "De man glimlachte naar de kinderen."] },
            pt: { t: "homem", def: "Um ser humano adulto do sexo masculino.", ex: ["Um homem alto abriu a porta.", "Ele é um homem sábio com grande experiência.", "O homem sorriu para as crianças."] }
        }
    },
    world: {
        en_def: "The earth, together with all of its countries and peoples.",
        s: ["earth", "globe"],
        ex: [
            "She traveled around the world.",
            "We want to make the world a better place.",
            "News travels fast in our modern world."
        ],
        translations: {
            pl: { t: "świat", def: "Ziemia wraz ze wszystkimi krajami i ludźmi.", ex: ["Podróżowała dookoła świata.", "Chcemy uczynić świat lepszym miejscem.", "Wiadomości szybko rozchodzą się we współczesnym świecie."] },
            de: { t: "Welt", def: "Die Erde mit allen Ländern und Völkern.", ex: ["Sie reiste um die Welt.", "Wir wollen die Welt zu einem besseren Ort machen.", "Nachrichten verbreiten sich schnell in unserer modernen Welt."] },
            es: { t: "mundo", def: "La tierra con todos sus países y pueblos.", ex: ["Ella viajó por todo el mundo.", "Queremos hacer del mundo un lugar mejor.", "Las noticias viajan rápido en nuestro mundo moderno."] },
            fr: { t: "monde", def: "La terre avec tous ses pays et ses peuples.", ex: ["Elle a voyagé autour du monde.", "Nous voulons faire du monde un endroit meilleur.", "Les nouvelles voyagent vite dans notre monde moderne."] },
            it: { t: "mondo", def: "La terra con tutti i suoi paesi e popoli.", ex: ["Ha viaggiato in tutto il mondo.", "Vogliamo rendere il mondo un posto migliore.", "Le notizie viaggiano veloci nel nostro modern world."] },
            cs: { t: "svět", def: "Země se všemi svými státy a lidmi.", ex: ["Cestovala kolem světa.", "Chceme udělat svět lepším místem.", "V našem moderním světě se zprávy šíří rychle."] },
            ja: { t: "世界", def: "すべての国や人々を含む地球。", ex: ["彼女は世界中を旅しました。", "私たちは世界をもっと良い場所にしたいと考えています。", "現代の世界ではニュースが速く伝わります。"] },
            ko: { t: "세계", def: "모든 나라와 사람들을 포함한 지구.", ex: ["그녀는 세계 곳곳을 여행했습니다.", "우리는 세상을 더 나은 곳으로 만들고 싶습니다.", "현대 세계에서는 뉴스가 빠르게 전달됩니다."] },
            nl: { t: "wereld", def: "De aarde met alle landen en volkeren.", ex: ["Zij reisde de wereld rond.", "We willen van de wereld een betere plek maken.", "Nieuws reist snel in onze moderne wereld."] },
            pt: { t: "mundo", def: "A terra com todos os seus países e povos.", ex: ["Ela viajou ao redor do mundo.", "Queremos fazer do mundo um lugar melhor.", "As notícias viajam rápido em nosso mundo moderno."] }
        }
    },
    life: {
        en_def: "The condition that distinguishes animals and plants from inorganic matter.",
        s: ["existence", "being"],
        ex: [
            "She lived a long and happy life.",
            "Water is essential for life.",
            "This discovery changed his life completely."
        ],
        translations: {
            pl: { t: "życie", def: "Stan odróżniający istoty żywe od materii nieożywionej.", ex: ["Przeżyła długie i szczęśliwe życie.", "Woda jest niezbędna do życia.", "To odkrycie całkowicie zmieniło jego życie."] },
            de: { t: "Leben", def: "Der Zustand, der lebende Organismen von anorganischer Materie unterscheidet.", ex: ["Sie lebte ein langes und glückliches Leben.", "Wasser ist lebensnotwendig.", "Diese Entdeckung hat sein Leben völlig verändert."] },
            es: { t: "vida", def: "La condición que distingue a los seres vivos de la materia inorgánica.", ex: ["Ella vivió una vida larga y feliz.", "El agua es esencial para la vida.", "Este descubrimiento cambió su vida por completo."] },
            fr: { t: "vie", def: "L'état qui distingue les êtres vivants de la matière inorganique.", ex: ["Elle a vécu une vie longue et heureuse.", "L'eau est essentielle à la vie.", "Cette découverte a complètement changé sa vie."] },
            it: { t: "vita", def: "La condizione che distingue gli esseri viventi dalla materia inorganica.", ex: ["Ha vissuto una vita lunga e felice.", "L'acqua è essenziale per la vita.", "Questa scoperta ha cambiato completamente la sua vita."] },
            cs: { t: "život", def: "Stav, který odlišuje živé organismy od anorganické hmoty.", ex: ["Prožila dlouhý a šťastný život.", "Voda je pro život nezbytná.", "Tento objev zcela změnil jeho život."] },
            ja: { t: "人生", def: "生物を無機物と区別する状態、または生涯。", ex: ["彼女は長くて幸せな人生を送りました。", "水は生命に不可欠です。", "この発見は彼の人生を完全に変えました。"] },
            ko: { t: "삶", def: "생명체를 무생물과 구별하는 상태 또는 일생.", ex: ["그녀는 길고 행복한 삶을 살았습니다.", "물은 생명에 필수적입니다.", "이 발견은 그의 삶을 완전히 바꾸어 놓았습니다."] },
            nl: { t: "leven", def: "De toestand die levende wezens onderscheidt van anorganische materie.", ex: ["Zij leidde een lang en gelukkig leven.", "Water is essentieel voor het leven.", "Deze ontdekking veranderde zijn leven volledig."] },
            pt: { t: "vida", def: "O estado que distingue os seres vivos da matéria inorgânica.", ex: ["Ela viveu uma vida longa e feliz.", "A água é essencial para a vida.", "Esta descoberta mudou a sua vida completamente."] }
        }
    },
    hand: {
        en_def: "The end part of a person's arm beyond the wrist.",
        s: ["palm"],
        ex: [
            "He raised his hand to ask a question.",
            "She held my hand tightly.",
            "Wash your hands before eating."
        ],
        translations: {
            pl: { t: "ręka", def: "Końcowa część kończyny górnej człowieka od nadgarstka.", ex: ["Podniósł rękę, aby zadać pytanie.", "Mocno trzymała moją rękę.", "Umyj ręce przed jedzeniem."] },
            de: { t: "Hand", def: "Der am Handgelenk ansetzende Teil des menschlichen Arms.", ex: ["Er hob die Hand, um eine Frage zu stellen.", "Sie hielt meine Hand fest.", "Wasche deine Hände vor dem Essen."] },
            es: { t: "mano", def: "La parte final del brazo humano más allá de la muñeca.", ex: ["Levantó la mano para hacer una pregunta.", "Ella sostuvo mi mano con fuerza.", "Lávate las manos antes de comer."] },
            fr: { t: "main", def: "La partie terminale du bras humain au-delà du poignet.", ex: ["Il a levé la main pour poser une question.", "Elle a serré ma main fermement.", "Lavez-vous les mains avant de manger."] },
            it: { t: "mano", def: "La parte terminale del braccio umano oltre il polso.", ex: ["Ha alzato la mano per fare una domanda.", "Mi ha tenuto la mano stretta.", "Lavati le mani prima di mangiare."] },
            cs: { t: "ruka", def: "Koncová část lidské paže od zápěstí.", ex: ["Zvedl ruku, aby položil otázku.", "Pevně držela mou ruku.", "Před jídlem si umyjte ruce."] },
            ja: { t: "手", def: "手首から先の身体の部分。", ex: ["彼は質問するために手を挙げました。", "彼女は私の手を強く握りました。", "食事の前には手を洗いましょう。"] },
            ko: { t: "손", def: "손목 너머의 인체 팔 끝부분.", ex: ["그는 질문을 하기 위해 손을 들었습니다.", "그녀는 내 손을 꽉 잡았습니다.", "식사 전에 손을 씻으세요."] },
            nl: { t: "hand", def: "Het uiteinde van de menselijke arm voorbij de pols.", ex: ["Hij stak zijn hand op om een vraag te stellen.", "Ze hield mijn hand stevig vast.", "Was je handen voor het eten."] },
            pt: { t: "mão", def: "A parte terminal do braço humano após o pulso.", ex: ["Ele levantou a mão para fazer uma pergunta.", "Ela segurou a minha mão com força.", "Lave as mãos antes de comer."] }
        }
    }
};

const outputDir = path.join(__dirname, "../dictionaries/packs");
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

const targetLangs = ["pl", "de", "es", "fr", "it", "cs", "ja", "ko", "nl", "pt"];

for (const lang of targetLangs) {
    const pack = {
        schemaVersion: 2,
        source: "en",
        target: lang,
        updatedAt: Date.now(),
        entries: {}
    };

    for (const [word, data] of Object.entries(starterData)) {
        const tr = data.translations[lang];
        if (!tr) continue;

        pack.entries[word] = {
            t: tr.t,
            d: {
                s: data.en_def,
                t: tr.def
            },
            s: data.s,
            e: [
                { s: data.ex[0], t: tr.ex[0] },
                { s: data.ex[1], t: tr.ex[1] },
                { s: data.ex[2], t: tr.ex[2] }
            ],
            languageValidation: 1
        };
    }

    const filePath = path.join(outputDir, `en-${lang}.json`);
    fs.writeFileSync(filePath, JSON.stringify(pack, null, 2), "utf-8");
    console.log(`Generated starter pack: ${filePath} (${Object.keys(pack.entries).length} words)`);
}
