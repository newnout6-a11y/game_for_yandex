/**
 * Discover only this developer's Yandex games through the platform's authenticated
 * catalog. No hardcoded destinations, third-party ad networks, social links or
 * navigation during a live run are accepted here.
 */
export async function loadOwnGames(sdk) {
  const api=sdk?.get?.()?.features?.GamesAPI;
  if(typeof api?.getAllGames!=='function')return [];
  try{
    const response=await api.getAllGames();
    const unique=new Set(),games=[];
    for(const item of Array.isArray(response?.games)?response.games:[]){
      const id=String(item?.appID??''),title=typeof item?.title==='string'?item.title.trim():'';
      if(!/^\d{1,16}$/.test(id)||!title||unique.has(id))continue;
      let url;try{url=new URL(item.url);}catch{continue;}
      if(url.protocol!=='https:'||url.username||url.password||!/(^|\.)yandex\.(ru|com)$/.test(url.hostname))continue;
      unique.add(id);games.push(Object.freeze({appID:id,title:title.slice(0,120),url:url.href}));
      if(games.length===12)break;
    }
    return games;
  }catch{return [];}
}

/** Open a previously SDK-verified catalog entry only from an explicit non-game menu action, preserving this tab. */
export function openOwnGame(games,id,{screen,open=globalThis.open}={}){
  if(!['hub','garage','results'].includes(screen)||typeof open!=='function')return false;
  const game=games?.find(item=>item.appID===String(id));if(!game)return false;
  open(game.url,'_blank','noopener,noreferrer');return true;
}
