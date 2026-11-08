-- 栖境 · the cloud sea's old tortoise, the fourth guardian: at his tai chi on the jade terrace, he teaches the company's
-- finance lessons, the 名企之道 course and the KPI lessons (he has no demo lessons). A guardian without published lessons
-- does not show on any screen, so this can be applied before lessons are given to him. His lines can be changed on the
-- admin page; re-running this leaves them as they are.
insert into qj.guardians (id, world, name, title, portrait, lines, sort) values ('tortoise', 'cloudsea', '太极龟', '云海的守护者', 'guardians/tortoise.jpg', $j${"hello":[{"from":5,"to":11,"text":"早。云海才刚翻起来，正好打一趟拳。想学点什么？"},{"from":11,"to":17,"text":"来了？不急。这一趟拳我打了几百年，慢慢来。想学点什么？"},{"from":17,"to":20,"text":"日头西沉，云海都染成金色了。趁天光还在，学一样吧。"},{"from":20,"to":29,"text":"夜深了，灯笼都亮了。慢慢来，想学点什么，我陪你。"}],"allDone":"该说的，我都说给你听了。想重温哪一课？","start":"好。慢慢来，一步一步走。","resume":"上次说到一半，我们接着往下说。","later":"下次再说","bye":"去吧。我一直在这玉台上，想学的时候再来。","coming":"老龟收住拳势，缓缓转过身来……","returning":"老龟刚回到拳架里，听见你在叫它……又转过身来。","gift":"云海里多了一位新朋友：{what}「{name}」。算是我送你的。","review":"上次没答对的题，我们再走一遍。不急。","reviewDone":"都答对了。好，好。这些就是你的了。","handoff":"我这里的课，你都学会了。下一课在{world}，去找{who}吧。"}$j$::jsonb, 3)
on conflict (id) do nothing;
