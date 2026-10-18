import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {GARAGE_SCREEN_MEDIA} from '../src/garage-screen-media.js';

const report=JSON.parse(await readFile(new URL('../art/garage/screen/supplied-video-provenance.json',import.meta.url),'utf8'));
const movie=await readFile(new URL(GARAGE_SCREEN_MEDIA.video));
/** Enumerate bounded ISO-BMFF children without running the supplied media or requiring ffmpeg in npm test. */
function boxes(start=0,end=movie.length){
 const result=[];while(start<end){assert.ok(end-start>=8);let size=movie.readUInt32BE(start),header=8;const type=movie.toString('ascii',start+4,start+8);
 if(size===1){assert.ok(end-start>=16);size=Number(movie.readBigUInt64BE(start+8));header=16;}if(size===0)size=end-start;
 assert.ok(Number.isSafeInteger(size)&&size>=header&&start+size<=end,`Bounded ${type} atom`);result.push({type,start,payload:start+header,end:start+size});start+=size;
 }return result;
}
/** Find a required direct child of an already validated container. */
function child(parent,type){const box=boxes(parent.payload,parent.end).find(item=>item.type===type);assert.ok(box,`${parent.type}/${type}`);return box;}

test('the complete supplied stunt has one video track, all 1,052 frames, original aspect and no audio',()=>{
 const top=boxes(),moov=top.find(item=>item.type==='moov'),mdat=top.find(item=>item.type==='mdat');assert.ok(moov&&mdat&&moov.start<mdat.start,'Fast-start metadata precedes media payload');
 const tracks=boxes(moov.payload,moov.end).filter(item=>item.type==='trak');assert.equal(tracks.length,1);
 const mdia=child(tracks[0],'mdia'),hdlr=child(mdia,'hdlr');assert.equal(movie.toString('ascii',hdlr.payload+8,hdlr.payload+12),'vide');
 const mdhd=child(mdia,'mdhd');assert.equal(movie[mdhd.payload],0);const timescale=movie.readUInt32BE(mdhd.payload+12),duration=movie.readUInt32BE(mdhd.payload+16)/timescale;
 assert.ok(Math.abs(duration-43.8771666667)<1e-6);assert.equal(timescale,24000);
 const stbl=child(child(mdia,'minf'),'stbl'),stsz=child(stbl,'stsz');assert.equal(movie.readUInt32BE(stsz.payload+8),1052);
 const stsd=child(stbl,'stsd'),entry=stsd.payload+8;assert.equal(movie.toString('ascii',entry+4,entry+8),'avc1');assert.equal(movie.readUInt16BE(entry+32),640);assert.equal(movie.readUInt16BE(entry+34),360);
});

test('user-supplied media hashes and truthful attribution match the local playback assets',async()=>{
 assert.equal(GARAGE_SCREEN_MEDIA.status,'user-supplied-tesla-kickflip');assert.equal(report.credited_creator,'Tesla');assert.equal(report.video.decoded_frames_identical,true);assert.equal(report.video.audio_streams,0);assert.equal(report.video.frames,1052);
 assert.match(report.rights.authorship,/Third-party/);assert.match(report.rights.redistribution_license,/Not asserted/);assert.match(report.transformation.video,/no crop, resize, retiming or re-encoding/);
 for(const record of report.files){const bytes=await readFile(new URL('../'+record.path,import.meta.url));assert.equal(bytes.length,record.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);}
 assert.ok(movie.length<2_000_000);assert.equal(report.input.sha256,'323613fa17f6affcb2d04e9620e877ce28ab0d2cbcb3dffa3a8c628946f5b085');
});

test('the importer retains the full timeline rather than trimming or re-encoding footage',async()=>{
 const source=await readFile(new URL('../scripts/import_garage_screen.py',import.meta.url),'utf8');
 assert.match(source,/'-c:v', 'copy', '-an', '-movflags', '\+faststart'/);assert.match(source,/original_frames != output_frames/);assert.match(source,/poster_time < duration/);
 assert.doesNotMatch(source,/'-t'|'-to'|'-vf'|libx264/);
});
