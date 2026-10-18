import test from 'node:test';
import assert from 'node:assert/strict';
import {loadOwnGames,openOwnGame} from '../src/own-games.js';
test('own game catalog has no fake offline products or unverified destinations',async()=>{
 assert.deepEqual(await loadOwnGames({get:()=>null}),[]);
 const games=await loadOwnGames({get:()=>({features:{GamesAPI:{getAllGames:async()=>({games:[{appID:12,title:'Our game',url:'https://yandex.ru/games/app/12'},{appID:12,title:'Duplicate',url:'https://yandex.ru/games/app/12'},{appID:15,title:'Unsafe',url:'javascript:alert(1)'},{appID:16,title:'Outside',url:'https://example.com/'},{appID:17,title:'Spoof',url:'https://yandex.ru.evil.test/'},{appID:18,title:'Credentials',url:'https://name:pass@yandex.ru/games/app/18'}]})}}})});
 assert.equal(games.length,1);assert.equal(games[0].appID,'12');assert.equal(Object.isFrozen(games[0]),true);
});
test('cross-promotion needs an explicit menu action and retains current tab',()=>{
 const calls=[],games=[{appID:'12',url:'https://yandex.ru/games/app/12'}],open=(...args)=>calls.push(args);
 for(const screen of ['playing','paused','loading'])assert.equal(openOwnGame(games,'12',{screen,open}),false);
 assert.equal(openOwnGame(games,'unknown',{screen:'hub',open}),false);
 assert.equal(openOwnGame(games,'12',{screen:'results',open}),true);assert.deepEqual(calls,[[games[0].url,'_blank','noopener,noreferrer']]);
});
