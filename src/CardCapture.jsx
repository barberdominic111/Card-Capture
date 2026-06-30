import { useState, useEffect, useRef } from "react";

// Inject steal animation keyframes once
const styleEl = document.createElement("style");
styleEl.textContent = `
  @keyframes shake {
    0%  { transform: translateX(0); }
    15% { transform: translateX(-5px) rotate(-3deg); }
    30% { transform: translateX(5px)  rotate(3deg); }
    45% { transform: translateX(-5px) rotate(-2deg); }
    60% { transform: translateX(4px)  rotate(2deg); }
    75% { transform: translateX(-3px); }
    100%{ transform: translateX(0); }
  }
  @keyframes flashRed {
    0%,100% { box-shadow: none; }
    25%      { box-shadow: 0 0 0 3px #e74c3c, 0 0 16px rgba(231,76,60,0.7); }
    75%      { box-shadow: 0 0 0 3px #e74c3c, 0 0 16px rgba(231,76,60,0.7); }
  }
  @keyframes arrowSlide {
    0%   { opacity:0; transform: translateX(-12px); }
    20%  { opacity:1; transform: translateX(0); }
    80%  { opacity:1; transform: translateX(0); }
    100% { opacity:0; transform: translateX(12px); }
  }
  @keyframes popIn {
    0%   { opacity:0; transform: scale(0.5); }
    60%  { opacity:1; transform: scale(1.12); }
    100% { opacity:1; transform: scale(1); }
  }
  @keyframes fadeOut {
    0%   { opacity:1; transform: scale(1); }
    100% { opacity:0; transform: scale(0.6); }
  }
  .steal-shake  { animation: shake 0.5s ease, flashRed 0.5s ease; }
  .steal-fadeout{ animation: fadeOut 0.3s ease forwards; }
  .steal-popin  { animation: popIn 0.35s ease forwards; }
  .steal-arrow  { animation: arrowSlide 1.2s ease forwards; }
`;
if (!document.head.querySelector("#steal-styles")) {
  styleEl.id = "steal-styles";
  document.head.appendChild(styleEl);
}

const SUITS = ["♠","♥","♣","♦"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const RANK_VALUES = {2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10};
const NUMBER_RANKS = new Set(["2","3","4","5","6","7","8","9","10"]);
const SUIT_COLOR  = {"♠":"#1a1a2e","♥":"#c0392b","♣":"#1565c0","♦":"#1a7a3c"};
const SUIT_ACCENT = {"♠":"#6a7aff","♥":"#ff6b6b","♣":"#5ba4f5","♦":"#4ecb71"};

const buildDeck = () => SUITS.flatMap(s => RANKS.map(r => ({suit:s,rank:r,id:`${r}${s}`})));
const shuffle = a => {
  const b=[...a];
  for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];}
  return b;
};

function findCaptures(played, market) {
  const direct = market.filter(c => c.rank === played.rank);
  const sums = [];
  if (NUMBER_RANKS.has(played.rank)) {
    const pv = RANK_VALUES[played.rank];
    const nm = market.filter(c => NUMBER_RANKS.has(c.rank));
    for (let i=0;i<nm.length;i++)
      for (let j=i+1;j<nm.length;j++)
        if (RANK_VALUES[nm[i].rank]+RANK_VALUES[nm[j].rank]===pv)
          sums.push([nm[i],nm[j]]);
  }
  return {direct,sums};
}

function getBankable(pile) {
  const g={};
  pile.forEach(c=>{g[c.rank]=g[c.rank]||[];g[c.rank].push(c);});
  return Object.entries(g)
    .filter(([,v])=>v.length>=3)
    .map(([rank,cards])=>({rank,cards,bonus:cards.length>=4}));
}

// Group capture pile by rank, sorted by count desc
function groupByRank(pile) {
  const g={};
  pile.forEach(c=>{g[c.rank]=g[c.rank]||[];g[c.rank].push(c);});
  return Object.entries(g).sort((a,b)=>b[1].length-a[1].length);
}

function findStealTargets(players, myId) {
  const targets = [];
  for (const p of players) {
    if (p.id === myId) continue;
    const g={};
    p.capturePile.forEach(c=>{g[c.rank]=g[c.rank]||[];g[c.rank].push(c);});
    for (const [rank,cards] of Object.entries(g))
      if (cards.length===1||cards.length===2)
        targets.push({playerId:p.id,playerName:p.name,rank,cards});
  }
  return targets;
}

function applyBanking(capturePile, currentPoints) {
  let pile=[...capturePile], points=currentPoints, bonus=false;
  const msgs=[];
  for (const set of getBankable(pile)) {
    const toBank=set.bonus?set.cards:set.cards.slice(0,3);
    pile=pile.filter(c=>!toBank.find(x=>x.id===c.id));
    points+=1;
    if(set.bonus) bonus=true;
    msgs.push(`Banked ${set.rank}s → ${points}VP${set.bonus?" +BONUS!":""}`);
  }
  return {pile,points,bonus,msgs};
}

// Find next player index who still has cards, starting after `from`.
// Returns -1 if nobody has cards (game over).
function nextPlayerWithCards(players, from) {
  const n = players.length;
  for (let i=1;i<=n;i++) {
    const idx=(from+i)%n;
    if(players[idx].hand.length>0) return idx;
  }
  return -1;
}

function isGameOver(players) {
  return players.every(p=>p.hand.length===0);
}

// Peek at what the AI would steal (without mutating state), returns {victimId,rank,cards} or null
function aiPeekSteal(st) {
  const ai=st.players[st.currentPlayer];
  const steals=findStealTargets(st.players,ai.id);
  for(const card of ai.hand){
    const t=steals.find(x=>x.rank===card.rank);
    if(t) return {victimId:t.playerId,rank:t.rank,cards:t.cards};
  }
  return null;
}

function initGame(np) {
  const deck=shuffle(buildDeck());
  let di=0;
  const players=Array.from({length:np},(_,i)=>({
    id:i,name:i===0?"You":`AI ${i}`,isAI:i!==0,
    hand:deck.slice(di,di+=5),capturePile:[],points:0,
  }));
  const market=deck.slice(di,di+=4);
  return {players,market,drawPile:deck.slice(di),currentPlayer:0,log:["Your turn!"],gameOver:false,turnCount:0};
}

// ─── AI ───────────────────────────────────────────────────────────────────────
function aiTakeTurn(st) {
  let s={
    ...st,
    players:st.players.map(p=>({...p,hand:[...p.hand],capturePile:[...p.capturePile]})),
    market:[...st.market],
    drawPile:[...st.drawPile],
  };
  const ai=s.players[s.currentPlayer];
  const logs=[];

  // Steal first if possible
  const steals=findStealTargets(s.players,ai.id);
  let didSteal=false;
  for (const card of ai.hand) {
    const t=steals.find(x=>x.rank===card.rank);
    if(t){
      ai.hand=ai.hand.filter(c=>c.id!==card.id);
      s.players[t.playerId].capturePile=s.players[t.playerId].capturePile.filter(c=>c.rank!==t.rank);
      ai.capturePile.push(card,...t.cards);
      logs.push(`${ai.name} stole ${t.rank}s from ${t.playerName}!`);
      didSteal=true; break;
    }
  }

  if(!didSteal){
    let chosen=null,cap=null,capType=null;
    for(const card of ai.hand){
      const c=findCaptures(card,s.market);
      if(c.direct.length){chosen=card;cap=c.direct;capType="direct";break;}
      if(c.sums.length&&!chosen){chosen=card;cap=c.sums[0];capType="sum";}
    }
    if(!chosen) chosen=ai.hand[Math.floor(Math.random()*ai.hand.length)];
    ai.hand=ai.hand.filter(c=>c.id!==chosen.id);
    logs.push(`${ai.name} played ${chosen.rank}${chosen.suit}`);
    if(capType==="direct"){
      ai.capturePile.push(chosen,...cap);
      s.market=s.market.filter(c=>!cap.find(x=>x.id===c.id));
      logs.push(`Captured ${[chosen,...cap].map(c=>c.rank+c.suit).join(" ")}`);
    }else if(capType==="sum"){
      ai.capturePile.push(chosen,...cap);
      s.market=s.market.filter(c=>!cap.find(x=>x.id===c.id));
      logs.push(`Sum capture!`);
    }else{
      s.market=[...s.market,chosen];
      logs.push(`${chosen.rank}${chosen.suit} → market`);
    }
  }

  const banked=applyBanking(ai.capturePile,ai.points);
  ai.capturePile=banked.pile; ai.points=banked.points;
  logs.push(...banked.msgs);

  const need=Math.max(0,5-ai.hand.length);
  ai.hand.push(...s.drawPile.slice(0,need));
  s.drawPile=s.drawPile.slice(need);

  const gameOver=isGameOver(s.players);
  let next;
  if(gameOver){ next=s.currentPlayer; }
  else if(!gameOver&&banked.bonus){ next=s.currentPlayer; logs.push(`${ai.name} earns a bonus turn!`); }
  else{
    next=nextPlayerWithCards(s.players,s.currentPlayer);
    if(next===-1){ next=s.currentPlayer; } // will trigger gameOver next cycle
  }

  return {...s,currentPlayer:next,log:[...s.log,...logs].slice(-30),gameOver,turnCount:(s.turnCount||0)+1};
}

// ─── Card ─────────────────────────────────────────────────────────────────────
function Card({card,size="md",selected,onClick,dimmed,stealable}) {
  const w=size==="sm"?38:size==="xs"?28:52;
  const h=size==="sm"?54:size==="xs"?40:76;
  const rz=size==="xs"?8:size==="sm"?10:13;
  const sz=size==="xs"?11:size==="sm"?15:22;
  const col=SUIT_COLOR[card.suit], acc=SUIT_ACCENT[card.suit];
  return (
    <div onClick={onClick} style={{
      width:w,height:h,borderRadius:5,background:"#fff",
      border:`2px solid ${selected?acc:stealable?"#e74c3c":"#ccc"}`,
      boxShadow:selected?`0 0 0 2px ${acc},0 4px 14px rgba(0,0,0,0.35)`
        :stealable?"0 0 0 1.5px rgba(231,76,60,0.6)":"0 2px 5px rgba(0,0,0,0.2)",
      cursor:onClick?"pointer":"default",
      display:"flex",flexDirection:"column",justifyContent:"space-between",
      padding:`${size==="xs"?2:3}px ${size==="xs"?2:3}px`,
      userSelect:"none",flexShrink:0,
      opacity:dimmed?0.28:1,
      transform:selected?"translateY(-8px) scale(1.04)":"none",
      transition:"all 0.13s ease",
    }}>
      <div style={{color:col,fontSize:rz,fontWeight:700,lineHeight:1}}>{card.rank}</div>
      <div style={{color:col,fontSize:sz,textAlign:"center",lineHeight:1}}>{card.suit}</div>
      <div style={{color:col,fontSize:rz,fontWeight:700,lineHeight:1,alignSelf:"flex-end",transform:"rotate(180deg)"}}>{card.rank}</div>
    </div>
  );
}

// Vertically stacked rank group for capture pile
// handCount = how many of this rank the player holds in hand (shown as potential)
function RankStack({rank,cards,handCount,isMyTurn,onOpenBank,isBanking}) {
  const count=cards.length;
  const total=count+handCount;
  const ringColor=isBanking?"#f0c040":total>=4?"rgba(240,192,64,0.5)":total>=3?"rgba(78,203,113,0.5)":"rgba(255,255,255,0.1)";
  return (
    <div style={{
      display:"flex",flexDirection:"column",alignItems:"center",gap:0,
      background:isBanking?"rgba(240,192,64,0.13)":total>=3?"rgba(78,203,113,0.06)":"rgba(0,0,0,0.15)",
      border:`1.5px solid ${ringColor}`,
      borderRadius:7,padding:"4px 3px 5px",minWidth:34,
      transition:"border-color 0.2s",
    }}>
      {/* Stacked captured cards */}
      <div style={{position:"relative",width:28,height:Math.max(40,30+(count-1)*10),marginBottom:3}}>
        {cards.map((c,i)=>(
          <div key={c.id} style={{
            position:"absolute",top:i*10,left:0,zIndex:i,
            width:28,height:40,borderRadius:4,background:"#fff",
            border:`1.5px solid ${SUIT_COLOR[c.suit]}44`,
            boxShadow:"0 1px 4px rgba(0,0,0,0.35)",
            display:"flex",flexDirection:"column",justifyContent:"space-between",
            padding:"2px 3px",
          }}>
            <div style={{color:SUIT_COLOR[c.suit],fontSize:8,fontWeight:700,lineHeight:1}}>{c.rank}</div>
            <div style={{color:SUIT_COLOR[c.suit],fontSize:11,textAlign:"center",lineHeight:1}}>{c.suit}</div>
          </div>
        ))}
      </div>
      {/* Count: captured + hand hint */}
      <div style={{fontSize:9,fontWeight:700,lineHeight:1,marginTop:2,
        color:total>=4?"#f0c040":total>=3?"#4ecb71":total>=2?"#7a9a6a":"#3a5a3a"}}>
        {count}{handCount>0&&<span style={{color:"rgba(255,255,255,0.3)"}}>+{handCount}</span>}/4
      </div>
      {/* Bank button — available when captured+hand >= 3 */}
      {isMyTurn&&total>=3&&(
        <button onClick={()=>onOpenBank(rank)} style={{
          marginTop:4,padding:"2px 5px",borderRadius:4,fontSize:8,fontWeight:700,
          cursor:"pointer",fontFamily:"Georgia,serif",lineHeight:1.4,
          background:isBanking?"rgba(240,192,64,0.3)":total>=4?"rgba(240,192,64,0.15)":"rgba(78,203,113,0.13)",
          border:`1px solid ${isBanking?"#f0c040":total>=4?"rgba(240,192,64,0.7)":"#4ecb71"}`,
          color:isBanking?"#f0c040":total>=4?"#d4a820":"#4ecb71",
        }}>
          {isBanking?"▲ Banking…":total>=4?"★ Bank!":"Bank"}
        </button>
      )}
      {!isMyTurn&&total>=3&&(
        <div style={{fontSize:7,color:"#2a5a2a",marginTop:3,lineHeight:1}}>ready</div>
      )}
    </div>
  );
}

// ── Steal animation overlay ──────────────────────────────────────────────────
// Shows above everything during the steal sequence:
//   Phase "shake"   → stolen cards shake+flash in source strip (500ms)
//   Phase "arrow"   → arrow label slides between players (900ms)
//   Phase "popin"   → cards pop into destination (350ms)
// After all phases, onDone() is called to commit the real state update.
function StealAnimation({anim, onDone}) {
  const [phase, setPhase] = useState("shake"); // shake | arrow | popin | done

  useEffect(() => {
    if (!anim) return;
    setPhase("shake");
    const t1 = setTimeout(() => setPhase("arrow"), 550);
    const t2 = setTimeout(() => setPhase("popin"), 1450);
    const t3 = setTimeout(() => { setPhase("done"); onDone(); }, 1850);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [anim]);

  if (!anim || phase === "done") return null;

  const fromMe = anim.fromPlayerId === 0;
  // Arrow points down (toward your pile) when AI steals from you,
  // or up (toward opponent) when you steal from AI.
  const arrowDir = fromMe ? "↑ stealing →" : "↓ stolen ←";
  const label = fromMe
    ? `You steal ${anim.rank}s from ${anim.toName}!`
    : `${anim.fromName} steals your ${anim.rank}s!`;

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:500,
      pointerEvents:"none",
      display:"flex", flexDirection:"column",
      justifyContent:"center", alignItems:"center",
    }}>
      {/* Dark overlay pulse */}
      <div style={{
        position:"absolute", inset:0,
        background: phase==="shake"
          ? "rgba(231,76,60,0.08)"
          : "rgba(0,0,0,0)",
        transition:"background 0.4s",
      }}/>

      {/* Arrow + label banner */}
      {(phase==="arrow"||phase==="popin") && (
        <div className="steal-arrow" style={{
          background:"rgba(231,76,60,0.92)",
          border:"1.5px solid rgba(255,120,100,0.6)",
          borderRadius:12,
          padding:"10px 20px",
          display:"flex", flexDirection:"column", alignItems:"center", gap:6,
          boxShadow:"0 4px 24px rgba(231,76,60,0.5)",
        }}>
          <div style={{color:"#fff",fontSize:13,fontWeight:700,letterSpacing:0.5}}>
            🎯 {label}
          </div>
          <div style={{display:"flex", gap:6, alignItems:"center"}}>
            {anim.cards.map(c => (
              <div key={c.id} className={phase==="popin"?"steal-popin":""} style={{
                width:30, height:42, borderRadius:4, background:"#fff",
                border:`2px solid ${SUIT_COLOR[c.suit]}`,
                display:"flex", flexDirection:"column", justifyContent:"space-between",
                padding:"2px 3px",
              }}>
                <div style={{color:SUIT_COLOR[c.suit],fontSize:9,fontWeight:700,lineHeight:1}}>{c.rank}</div>
                <div style={{color:SUIT_COLOR[c.suit],fontSize:13,textAlign:"center",lineHeight:1}}>{c.suit}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shake pulse rings on source — only during shake phase */}
      {phase==="shake" && (
        <div style={{
          position:"absolute",
          top: fromMe ? "auto" : "18%",
          bottom: fromMe ? "22%" : "auto",
          left:"50%", transform:"translateX(-50%)",
          display:"flex", gap:4,
        }}>
          {anim.cards.map(c=>(
            <div key={c.id} className="steal-shake" style={{
              width:30, height:42, borderRadius:4, background:"#fff",
              border:`2px solid #e74c3c`,
              display:"flex", flexDirection:"column", justifyContent:"space-between",
              padding:"2px 3px",
            }}>
              <div style={{color:SUIT_COLOR[c.suit],fontSize:9,fontWeight:700,lineHeight:1}}>{c.rank}</div>
              <div style={{color:SUIT_COLOR[c.suit],fontSize:13,textAlign:"center",lineHeight:1}}>{c.suit}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Opponent strip
function OpponentStrip({player,isActive,stealGroups}) {
  const groups=groupByRank(player.capturePile);
  return (
    <div style={{
      background:isActive?"rgba(240,192,64,0.07)":"rgba(0,0,0,0.22)",
      border:`1px solid ${isActive?"rgba(240,192,64,0.3)":"rgba(255,255,255,0.05)"}`,
      borderRadius:8,padding:"5px 8px",display:"flex",alignItems:"center",gap:8,
    }}>
      <div style={{minWidth:30,flexShrink:0}}>
        <div style={{color:isActive?"#f0c040":"#5a7a5a",fontSize:8,fontWeight:700,letterSpacing:1}}>{player.name}</div>
        <div style={{color:"#fff",fontSize:14,fontWeight:700,lineHeight:1.2}}>{player.points}
          <span style={{fontSize:8,color:"#3a5a3a",marginLeft:2}}>VP</span></div>
        <div style={{color:"#2a4a2a",fontSize:8}}>{player.hand.length} cards</div>
      </div>
      <div style={{flex:1,display:"flex",gap:3,flexWrap:"wrap",alignItems:"flex-start",minHeight:28}}>
        {groups.map(([rank,cards])=>{
          const stealable=stealGroups&&(cards.length===1||cards.length===2)&&stealGroups.some(sg=>sg.rank===rank);
          return (
            <div key={rank} style={{position:"relative"}}>
              {cards.slice(0,3).map((c,i)=>(
                <div key={c.id} style={{
                  position:i===0?"relative":"absolute",
                  top:i===0?0:i*4,left:i===0?0:i*2,
                  zIndex:i,
                }}>
                  <Card card={c} size="xs" stealable={stealable&&i===cards.length-1}/>
                </div>
              ))}
              <div style={{
                position:"absolute",bottom:-3,right:-3,
                background:stealable?"#e74c3c":cards.length>=3?"#4ecb71":"rgba(0,0,0,0.7)",
                color:"#fff",fontSize:7,fontWeight:700,borderRadius:3,
                padding:"0 3px",lineHeight:"14px",zIndex:10,
              }}>{cards.length}</div>
            </div>
          );
        })}
        {player.capturePile.length===0&&<span style={{color:"#1a3a1a",fontSize:9,fontStyle:"italic"}}>empty</span>}
      </div>
      {stealGroups&&stealGroups.length>0&&<div style={{fontSize:10,color:"#e74c3c"}}>🎯</div>}
    </div>
  );
}

function Toast({msg}) {
  return msg?(
    <div style={{
      position:"fixed",top:14,left:"50%",transform:"translateX(-50%)",
      background:"rgba(6,14,8,0.97)",border:"1px solid rgba(240,192,64,0.45)",
      color:"#f0c040",padding:"6px 14px",borderRadius:18,fontSize:12,
      whiteSpace:"nowrap",zIndex:999,pointerEvents:"none",
      boxShadow:"0 4px 18px rgba(0,0,0,0.6)",maxWidth:300,textAlign:"center",
    }}>{msg}</div>
  ):null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function CardCapture() {
  const [screen,setScreen]=useState("setup");
  const [numPlayers,setNumPlayers]=useState(2);
  const [state,setState]=useState(null);
  const [selectedCard,setSelectedCard]=useState(null);
  const [captureOpts,setCaptureOpts]=useState(null);
  const [selectedSum,setSelectedSum]=useState(null);
  const [stealTargets,setStealTargets]=useState([]);
  const [animatingSteal,setAnimatingSteal]=useState(null); // {fromPlayerId,fromName,toPlayerId,toName,rank,cards,pendingState}
  const [toast,setToast]=useState("");
  const toastRef=useRef();
  const aiLock=useRef(false);

  const showToast=msg=>{if(!msg)return;setToast(msg);clearTimeout(toastRef.current);toastRef.current=setTimeout(()=>setToast(""),2400);};

  const clearSelection=()=>{
    setSelectedCard(null);setCaptureOpts(null);setSelectedSum(null);setStealTargets([]);
  };

  const startGame=n=>{
    aiLock.current=false;
    setState(initGame(n));setNumPlayers(n);clearSelection();setScreen("game");
  };

  // ── AI effect ──
  useEffect(()=>{
    if(!state||state.gameOver||screen!=="game") return;
    if(animatingSteal) return; // wait for animation to finish
    const cur=state.players[state.currentPlayer];
    if(!cur.isAI) return;
    if(cur.hand.length===0){
      const next=nextPlayerWithCards(state.players,state.currentPlayer);
      if(next===-1){setState(p=>({...p,gameOver:true}));setScreen("over");return;}
      setState(p=>({...p,currentPlayer:next,turnCount:(p.turnCount||0)+1,
        log:[...p.log,`${cur.name} has no cards, skipping`].slice(-30)}));
      return;
    }
    if(aiLock.current) return;
    aiLock.current=true;
    const t=setTimeout(()=>{
      // Peek at what the AI will do — if it's a steal, animate first
      const peek=aiPeekSteal(state);
      if(peek){
        // Build the post-steal state but don't apply it yet
        const pendingState=aiTakeTurn(state);
        setAnimatingSteal({
          fromPlayerId:state.currentPlayer,
          fromName:state.players[state.currentPlayer].name,
          toPlayerId:peek.victimId,
          toName:state.players[peek.victimId].name,
          rank:peek.rank,
          cards:peek.cards,
          pendingState,
        });
        aiLock.current=false;
      } else {
        setState(prev=>{
          if(!prev||prev.gameOver) return prev;
          const next=aiTakeTurn(prev);
          showToast(next.log[next.log.length-1]||"");
          if(next.gameOver) setScreen("over");
          return next;
        });
        aiLock.current=false;
      }
    },800);
    return()=>{clearTimeout(t);aiLock.current=false;};
  },[state?.currentPlayer,state?.turnCount,state?.gameOver,screen,animatingSteal]);

  // ── Human: select card ──
  const handleSelectCard=card=>{
    if(!state||state.gameOver||state.currentPlayer!==0) return;
    if(state.players[0].hand.length===0) return;
    if(selectedCard?.id===card.id){clearSelection();return;}
    setSelectedCard(card);setSelectedSum(null);
    const caps=findCaptures(card,state.market);
    setCaptureOpts((caps.direct.length||caps.sums.length)?caps:null);
    setStealTargets(findStealTargets(state.players,0).filter(t=>t.rank===card.rank));
  };

  // ── Human: play card ──
  const handlePlay=(forceSteal=null,forceMarket=false)=>{
    if(!selectedCard||!state) return;
    let s={...state,
      players:state.players.map(p=>({...p,hand:[...p.hand],capturePile:[...p.capturePile]})),
      market:[...state.market],drawPile:[...state.drawPile]};
    const player=s.players[0];
    player.hand=player.hand.filter(c=>c.id!==selectedCard.id);
    const logs=[];

    if(forceSteal){
      // Build the final state but hold it — animation commits it via onDone
      s.players[forceSteal.playerId].capturePile=
        s.players[forceSteal.playerId].capturePile.filter(c=>c.rank!==forceSteal.rank);
      player.capturePile.push(selectedCard,...forceSteal.cards);
      logs.push(`You stole ${forceSteal.rank}s from ${forceSteal.playerName}!`);
      const need2=Math.max(0,5-player.hand.length);
      player.hand.push(...s.drawPile.slice(0,need2));
      s.drawPile=s.drawPile.slice(need2);
      const gameOver2=isGameOver(s.players);
      const next2=gameOver2?0:nextPlayerWithCards(s.players,0)===-1?0:nextPlayerWithCards(s.players,0);
      const pendingState={...s,currentPlayer:next2,log:[...s.log,...logs].slice(-30),
        gameOver:gameOver2,turnCount:(s.turnCount||0)+1};
      clearSelection(); aiLock.current=false;
      setAnimatingSteal({
        fromPlayerId:0, fromName:"You",
        toPlayerId:forceSteal.playerId, toName:forceSteal.playerName,
        rank:forceSteal.rank, cards:forceSteal.cards,
        pendingState, gameOver:gameOver2,
      });
      return; // don't fall through to setState below
    }else if(forceMarket){
      s.market=[...s.market,selectedCard];
      logs.push(`${selectedCard.rank}${selectedCard.suit} → market`);
    }else if(captureOpts?.direct?.length){
      player.capturePile.push(selectedCard,...captureOpts.direct);
      s.market=s.market.filter(c=>!captureOpts.direct.find(x=>x.id===c.id));
      logs.push(`Captured ${[selectedCard,...captureOpts.direct].map(c=>c.rank+c.suit).join(" ")}`);
    }else if(selectedSum?.length===2){
      player.capturePile.push(selectedCard,...selectedSum);
      s.market=s.market.filter(c=>!selectedSum.find(x=>x.id===c.id));
      logs.push(`Sum capture!`);
    }else{
      s.market=[...s.market,selectedCard];
      logs.push(`${selectedCard.rank}${selectedCard.suit} → market`);
    }

    // No auto-banking for human — they decide manually via Bank buttons
    const need=Math.max(0,5-player.hand.length);
    player.hand.push(...s.drawPile.slice(0,need));
    s.drawPile=s.drawPile.slice(need);

    const gameOver=isGameOver(s.players);
    let next;
    if(gameOver){ next=0; }
    else{
      next=nextPlayerWithCards(s.players,0);
      if(next===-1) next=0;
    }

    showToast(logs[logs.length-1]||"");clearSelection();aiLock.current=false;
    const ns={...s,currentPlayer:next,log:[...s.log,...logs].slice(-30),gameOver,turnCount:(s.turnCount||0)+1};
    setState(ns);
    if(gameOver) setScreen("over");
  };

  // Banking panel state
  const [bankingRank,setBankingRank]=useState(null);       // rank currently being banked
  const [bankHandCards,setBankHandCards]=useState([]);     // hand card ids selected for this bank

  const openBankPanel=(rank)=>{
    setBankingRank(rank);
    setBankHandCards([]);
  };
  const closeBankPanel=()=>{setBankingRank(null);setBankHandCards([]);};

  const toggleBankHandCard=(card)=>{
    setBankHandCards(prev=>
      prev.find(c=>c.id===card.id)?prev.filter(c=>c.id!==card.id):[...prev,card]
    );
  };

  const confirmBank=()=>{
    if(!state||state.currentPlayer!==0||state.gameOver||!bankingRank) return;
    let s={...state,players:state.players.map(p=>({...p,hand:[...p.hand],capturePile:[...p.capturePile]}))};
    const player=s.players[0];
    const captured=player.capturePile.filter(c=>c.rank===bankingRank);
    const total=captured.length+bankHandCards.length;
    if(total<3) return;
    // All captured of this rank + selected hand cards leave permanently
    player.capturePile=player.capturePile.filter(c=>c.rank!==bankingRank);
    player.hand=player.hand.filter(c=>!bankHandCards.find(x=>x.id===c.id));
    player.points+=1;
    const isBonus=total>=4;
    const msg=isBonus
      ?`Banked ${total} ${bankingRank}s (incl. ${bankHandCards.length} from hand) — 1VP + BONUS TURN!`
      :`Banked ${total} ${bankingRank}s${bankHandCards.length>0?` (incl. ${bankHandCards.length} from hand)`:""} — 1VP`;
    showToast(msg);
    closeBankPanel();
    setState({...s,turnCount:(s.turnCount||0)+1,log:[...s.log,msg].slice(-30)});
  };

  // Called by StealAnimation when animation completes — commits the held state
  const onStealAnimDone=()=>{
    if(!animatingSteal) return;
    const {pendingState,gameOver} = animatingSteal;
    showToast(pendingState.log[pendingState.log.length-1]||"");
    setAnimatingSteal(null);
    setState(pendingState);
    if(gameOver) setScreen("over");
  };

  // Human with no cards — auto-skip
  useEffect(()=>{
    if(!state||state.gameOver||screen!=="game") return;
    if(state.currentPlayer!==0) return;
    const me=state.players[0];
    if(me.hand.length>0) return;
    // Human is out of cards; find next player with cards
    const next=nextPlayerWithCards(state.players,0);
    if(next===-1){setState(p=>({...p,gameOver:true}));setScreen("over");return;}
    setState(p=>({...p,currentPlayer:next,turnCount:(p.turnCount||0)+1,
      log:[...p.log,"You have no cards — passing your turn"].slice(-30)}));
    showToast("No cards left — passing turn");
  },[state?.currentPlayer,state?.turnCount,screen]);

  // ─── Screens ───────────────────────────────────────────────────────────────
  if(screen==="setup") return (
    <div style={S.bg}>
      <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",gap:20,padding:32}}>
        <div style={S.bigTitle}>CARD<br/>CAPTURE</div>
        <div style={{color:"#3a6a3a",fontSize:11,letterSpacing:3}}>SET-BANKING CARD GAME</div>
        <div style={{color:"#2a5a2a",fontSize:11,marginTop:8}}>How many players?</div>
        <div style={{display:"flex",gap:12}}>
          {[2,3,4].map(n=>(
            <button key={n} onClick={()=>startGame(n)} style={{
              ...S.btn,width:58,height:58,borderRadius:12,fontSize:20,fontWeight:700,
              background:"rgba(255,255,255,0.04)",border:"1.5px solid rgba(255,255,255,0.12)",color:"#7a9a6a",
            }}>{n}</button>
          ))}
        </div>
        <div style={{color:"#1a4a1a",fontSize:10,maxWidth:260,textAlign:"center",lineHeight:1.9,marginTop:4}}>
          Capture by rank match or sum.<br/>
          <span style={{color:"#c0392b"}}>Steal</span> 1–2 cards from opponents.<br/>
          Bank 3-of-a-kind for 1VP · Four-of-a-kind = bonus turn.
        </div>
      </div>
    </div>
  );

  if(screen==="over"&&state){
    const sorted=[...state.players].sort((a,b)=>b.points-a.points);
    return (
      <div style={S.bg}>
        <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",gap:14,padding:32}}>
          <div style={{color:"#f0c040",fontSize:24,fontWeight:700,letterSpacing:3}}>GAME OVER</div>
          {sorted.map((p,i)=>(
            <div key={p.id} style={{display:"flex",alignItems:"center",gap:12,opacity:i===0?1:0.5}}>
              <span style={{fontSize:i===0?18:14}}>{i===0?"🏆":"  "}</span>
              <span style={{color:i===0?"#f0c040":"#6a8a6a",fontSize:i===0?17:13,fontWeight:700}}>{p.name}</span>
              <span style={{color:"#fff",fontSize:i===0?17:13}}>{p.points} VP</span>
            </div>
          ))}
          <button onClick={()=>setScreen("setup")} style={{
            ...S.btn,marginTop:14,padding:"10px 26px",color:"#f0c040",
            border:"1.5px solid #f0c040",background:"rgba(240,192,64,0.1)",
            borderRadius:9,fontSize:13,letterSpacing:2,
          }}>NEW GAME</button>
        </div>
      </div>
    );
  }

  if(!state) return null;

  const me=state.players[0];
  const isMyTurn=state.currentPlayer===0&&!state.gameOver&&me.hand.length>0;
  const aiPlayers=state.players.filter(p=>p.isAI);
  const currentName=state.players[state.currentPlayer].name;
  const myGroups=groupByRank(me.capturePile);

  const marketSelected=id=>{
    if(!selectedCard) return false;
    if(captureOpts?.direct?.find(c=>c.id===id)) return true;
    if(selectedSum?.find(c=>c.id===id)) return true;
    return false;
  };
  const marketDim=id=>{
    if(!selectedCard||!captureOpts) return false;
    if(captureOpts.direct.length) return !captureOpts.direct.find(c=>c.id===id);
    return false;
  };
  const stealGroupsByPlayer=pid=>findStealTargets(state.players,0).filter(t=>t.playerId===pid);

  return (
    <div style={S.bg}>
      <Toast msg={toast}/>
      <StealAnimation anim={animatingSteal} onDone={onStealAnimDone}/>

      {/* Top bar */}
      <div style={S.topBar}>
        <div style={{color:"#1a4a1a",fontSize:10,fontWeight:700,letterSpacing:2}}>CARD CAPTURE</div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{color:"#1a4a1a",fontSize:10}}>🂠 {state.drawPile.length}</div>
          <button onClick={()=>{aiLock.current=false;setScreen("setup");}}
            style={{...S.btn,padding:"3px 8px",fontSize:10,color:"#2a5a2a",
              border:"1px solid rgba(255,255,255,0.07)",borderRadius:5}}>Menu</button>
        </div>
      </div>

      {/* Opponents */}
      <div style={{padding:"5px 10px 3px",display:"flex",flexDirection:"column",gap:5}}>
        {aiPlayers.map(p=>(
          <OpponentStrip key={p.id} player={p} isActive={state.currentPlayer===p.id}
            stealGroups={isMyTurn&&selectedCard?stealGroupsByPlayer(p.id):null}/>
        ))}
      </div>

      {/* Market */}
      <div style={S.tableArea}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
          <div style={{color:"#1a5a1a",fontSize:9,letterSpacing:2,fontWeight:700}}>MARKET</div>
          <div style={{color:"#1a3a1a",fontSize:9}}>deck: {state.drawPile.length}</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,justifyItems:"center",marginBottom:9}}>
          {state.market.map(card=>(
            <div key={card.id} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
              <Card card={card} size="sm"
                selected={marketSelected(card.id)}
                dimmed={marketDim(card.id)}
                onClick={isMyTurn&&captureOpts?.sums?.length&&!captureOpts?.direct?.length?()=>{
                  if(!selectedSum){setSelectedSum([card]);return;}
                  if(selectedSum.length===1&&selectedSum[0].id!==card.id){
                    const pair=[selectedSum[0],card];
                    const valid=captureOpts.sums.find(s=>
                      (s[0].id===pair[0].id&&s[1].id===pair[1].id)||
                      (s[1].id===pair[0].id&&s[0].id===pair[1].id));
                    setSelectedSum(valid?pair:[card]);
                  }
                }:undefined}
              />
              {isMyTurn&&captureOpts?.sums?.length&&!captureOpts?.direct?.length&&(
                <div style={{width:5,height:5,borderRadius:"50%",
                  background:selectedSum?.find(c=>c.id===card.id)?"#f0c040":"rgba(255,255,255,0.07)",
                  transition:"background 0.12s"}}/>
              )}
            </div>
          ))}
          {state.market.length===0&&(
            <div style={{gridColumn:"1/-1",color:"#1a3a1a",fontSize:10,textAlign:"center",padding:8,fontStyle:"italic"}}>
              Market empty
            </div>
          )}
        </div>

        {/* Action */}
        <div style={{textAlign:"center",minHeight:48}}>
          {!isMyTurn&&<div style={{color:"#1a3a1a",fontSize:11}}>{currentName} is thinking…</div>}
          {isMyTurn&&!selectedCard&&<div style={{color:"#2a5a2a",fontSize:11}}>Tap a card from your hand</div>}

          {isMyTurn&&selectedCard&&(
            <div style={{display:"flex",flexDirection:"column",gap:5,alignItems:"center"}}>

              {/* Direct capture */}
              {captureOpts?.direct?.length>0&&(
                <button onClick={()=>handlePlay()} style={{...S.actionBtn,borderColor:"#4ecb71",color:"#4ecb71",background:"rgba(78,203,113,0.09)"}}>
                  ✓ Capture {captureOpts.direct.map(c=>c.rank+c.suit).join(" ")}
                </button>
              )}

              {/* Sum capture */}
              {captureOpts?.sums?.length>0&&!captureOpts?.direct?.length&&(
                <div>
                  <div style={{color:"#3a7a5a",fontSize:10,marginBottom:4}}>
                    {selectedSum?.length===2?"Tap confirm":"Tap 2 market cards to sum-capture"}
                  </div>
                  {selectedSum?.length===2&&(
                    <button onClick={()=>handlePlay()} style={{...S.actionBtn,borderColor:"#5ba4f5",color:"#5ba4f5",background:"rgba(91,164,245,0.09)"}}>
                      ✓ Sum {selectedSum.map(c=>c.rank+c.suit).join("+")}
                    </button>
                  )}
                </div>
              )}

              {/* Steal options */}
              {stealTargets.length>0&&(
                <div style={{display:"flex",flexDirection:"column",gap:3,alignItems:"center"}}>
                  {stealTargets.map((t,i)=>(
                    <button key={i} onClick={()=>handlePlay(t)} style={{
                      ...S.actionBtn,borderColor:"#e74c3c",color:"#e74c3c",
                      background:"rgba(231,76,60,0.08)",
                    }}>
                      🎯 Steal {t.rank}s from {t.playerName} ({t.cards.length})
                    </button>
                  ))}
                </div>
              )}

              {/* Always available: pass card to market */}
              <button onClick={()=>handlePlay(null,true)} style={{
                ...S.actionBtn,
                borderColor:"rgba(255,255,255,0.18)",color:"#5a7a5a",
                background:"transparent",fontSize:11,padding:"5px 12px",
              }}>
                → Add to market
              </button>

            </div>
          )}
        </div>
      </div>

      {/* My captures — grouped vertical stacks */}
      <div style={S.myCapture}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{color:"#1a5a1a",fontSize:9,letterSpacing:2,fontWeight:700}}>YOUR CAPTURES</div>
          <div style={{color:"#f0c040",fontSize:12,fontWeight:700}}>{me.points} <span style={{fontSize:8,color:"#3a5a3a"}}>VP</span></div>
        </div>
        {myGroups.length===0
          ?<div style={{color:"#1a3a1a",fontSize:10,fontStyle:"italic"}}>none yet</div>
          :<div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:2,alignItems:"flex-end"}}>
            {myGroups.map(([rank,cards])=>{
              const handCount=me.hand.filter(c=>c.rank===rank).length;
              return <RankStack key={rank} rank={rank} cards={cards}
                handCount={handCount} isMyTurn={isMyTurn}
                onOpenBank={openBankPanel}
                isBanking={bankingRank===rank}/>;
            })}
          </div>
        }

        {/* Bank panel — shown when a rank is selected for banking */}
        {bankingRank&&(()=>{
          const captured=me.capturePile.filter(c=>c.rank===bankingRank);
          const handOptions=me.hand.filter(c=>c.rank===bankingRank);
          const total=captured.length+bankHandCards.length;
          const canConfirm=total>=3;
          const isBonus=total>=4;
          return (
            <div style={{
              marginTop:8,padding:"8px 10px",borderRadius:8,
              background:"rgba(0,0,0,0.35)",border:"1px solid rgba(240,192,64,0.3)",
            }}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div style={{color:"#a08030",fontSize:10,fontWeight:700,letterSpacing:1}}>
                  BANK {bankingRank}s — {total}/4 selected
                </div>
                <button onClick={closeBankPanel} style={{
                  ...S.btn,color:"#3a5a3a",fontSize:12,lineHeight:1,padding:"0 4px",
                }}>✕</button>
              </div>

              {/* Captured cards — always included */}
              <div style={{marginBottom:5}}>
                <div style={{color:"#2a5a2a",fontSize:8,marginBottom:3}}>CAPTURED (all included):</div>
                <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                  {captured.map(c=><Card key={c.id} card={c} size="xs"/>)}
                </div>
              </div>

              {/* Hand cards — optional, tap to toggle */}
              {handOptions.length>0&&(
                <div style={{marginBottom:6}}>
                  <div style={{color:"#2a5a2a",fontSize:8,marginBottom:3}}>
                    FROM YOUR HAND (tap to include):
                  </div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    {handOptions.map(c=>{
                      const sel=bankHandCards.find(x=>x.id===c.id);
                      return (
                        <div key={c.id} onClick={()=>toggleBankHandCard(c)}
                          style={{opacity:sel?1:0.45,cursor:"pointer",
                            transform:sel?"translateY(-4px)":"none",transition:"all 0.13s"}}>
                          <Card card={c} size="xs" selected={!!sel}/>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{color:"#2a4a2a",fontSize:8,marginTop:3}}>
                    These leave your hand permanently
                  </div>
                </div>
              )}

              <div style={{display:"flex",gap:6,justifyContent:"center",marginTop:4}}>
                <button onClick={closeBankPanel} style={{
                  ...S.btn,padding:"5px 12px",fontSize:11,borderRadius:6,
                  border:"1px solid rgba(255,255,255,0.12)",color:"#4a6a4a",
                }}>Cancel</button>
                <button onClick={confirmBank} disabled={!canConfirm} style={{
                  ...S.btn,padding:"5px 14px",fontSize:11,fontWeight:700,borderRadius:6,
                  border:`1px solid ${canConfirm?(isBonus?"#f0c040":"#4ecb71"):"#2a3a2a"}`,
                  color:canConfirm?(isBonus?"#f0c040":"#4ecb71"):"#2a3a2a",
                  background:canConfirm?(isBonus?"rgba(240,192,64,0.12)":"rgba(78,203,113,0.1)"):"transparent",
                  cursor:canConfirm?"pointer":"default",
                }}>
                  {isBonus?"★ Bank 4 — 1VP + Bonus!":canConfirm?"Bank 3 — 1VP":`Need ${3-total} more`}
                </button>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Hand */}
      <div style={S.handArea}>
        <div style={{color:"#1a5a1a",fontSize:9,letterSpacing:2,fontWeight:700,marginBottom:7}}>
          YOUR HAND{isMyTurn&&<span style={{color:"#f0c040",fontSize:8}}> · TAP TO PLAY</span>}
          {!isMyTurn&&me.hand.length===0&&<span style={{color:"#3a5a3a",fontSize:8}}> · WAITING</span>}
        </div>
        <div style={{display:"flex",gap:7,overflowX:"auto",paddingBottom:2,
          justifyContent:me.hand.length<=5?"center":"flex-start"}}>
          {me.hand.map(card=>(
            <Card key={card.id} card={card} size="md"
              selected={selectedCard?.id===card.id}
              dimmed={isMyTurn&&!!selectedCard&&selectedCard.id!==card.id}
              onClick={isMyTurn?()=>handleSelectCard(card):undefined}/>
          ))}
          {me.hand.length===0&&<span style={{color:"#1a3a1a",fontSize:11,fontStyle:"italic"}}>No cards in hand</span>}
        </div>
      </div>
    </div>
  );
}

const S={
  bg:{minHeight:"100vh",maxWidth:480,margin:"0 auto",
    background:"linear-gradient(170deg,#091a0d 0%,#060e08 100%)",
    display:"flex",flexDirection:"column",fontFamily:"Georgia,serif",position:"relative"},
  topBar:{display:"flex",justifyContent:"space-between",alignItems:"center",
    padding:"8px 12px 6px",borderBottom:"1px solid rgba(255,255,255,0.04)"},
  tableArea:{flex:1,margin:"5px 10px",padding:"9px 11px",
    background:"rgba(0,0,0,0.2)",borderRadius:11,border:"1px solid rgba(255,255,255,0.05)"},
  myCapture:{margin:"0 10px 5px",padding:"7px 10px",
    background:"rgba(0,0,0,0.18)",borderRadius:9,border:"1px solid rgba(255,255,255,0.04)"},
  handArea:{padding:"9px 12px 14px",background:"rgba(0,0,0,0.36)",
    borderTop:"1px solid rgba(255,255,255,0.05)"},
  btn:{cursor:"pointer",fontFamily:"Georgia,serif",background:"transparent"},
  actionBtn:{padding:"7px 16px",borderRadius:7,fontSize:12,cursor:"pointer",
    fontFamily:"Georgia,serif",fontWeight:700,border:"1.5px solid #f0c040",
    color:"#f0c040",background:"rgba(240,192,64,0.09)",transition:"all 0.13s"},
  bigTitle:{color:"#f0c040",fontSize:40,fontWeight:700,letterSpacing:6,lineHeight:1.1,textAlign:"center"},
};
