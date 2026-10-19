"""Prepare the complete user-supplied stunt video for the workshop TV, without re-encoding video."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def probe(path):
    """Return ffprobe stream/container metadata without executing or trusting the supplied file."""
    result = subprocess.run(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(path)], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def digest(path):
    """Hash exact file bytes for reproducible input/output provenance."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def frame_hashes(path):
    """Decode every video frame and return per-frame checksums, rejecting any decode failure."""
    result = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:v:0', '-f', 'framemd5', '-'], check=True, capture_output=True, text=True)
    return [line for line in result.stdout.splitlines() if line and not line.startswith('#')]


def prepare(source, poster_time):
    """Copy the full H.264 timeline, remove audio, and extract an uncropped representative JPEG."""
    source = source.resolve()
    before = probe(source)
    videos = [stream for stream in before['streams'] if stream['codec_type'] == 'video']
    if len(videos) != 1 or videos[0]['codec_name'] != 'h264':
        raise ValueError('Expected the supplied single-stream H.264 video; do not silently transcode another format.')
    stream = videos[0]
    duration = float(stream['duration'])
    if not 0 <= poster_time < duration:
        raise ValueError('Poster timestamp must lie inside the complete video timeline.')
    directory = ROOT / 'public/assets/garage'
    directory.mkdir(parents=True, exist_ok=True)
    movie, poster = directory / 'roadster-screen-loop.mp4', directory / 'roadster-screen-poster.jpg'
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(source), '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart', '-y', str(movie)], check=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(poster_time), '-i', str(movie), '-frames:v', '1', '-q:v', '2', '-y', str(poster)], check=True)
    after = probe(movie)
    original_frames, output_frames = frame_hashes(source), frame_hashes(movie)
    if original_frames != output_frames:
        raise AssertionError('The full decoded video timeline must remain byte-identical frame by frame.')
    if any(item['codec_type'] != 'video' for item in after['streams']):
        raise AssertionError('The TV copy must have no audio or extra streams.')
    records = [{'path': str(path.relative_to(ROOT)), 'bytes': path.stat().st_size, 'sha256': digest(path)} for path in [movie, poster]]
    data = {
        'status': 'user-supplied-local-integration',
        'title': 'The Kickflip | Roadster',
        'credited_creator': 'Tesla',
        'reference_url': 'https://www.youtube.com/watch?v=r5vsHHPVhJg',
        'input': {'delivery': 'User-provided MP4', 'bytes': source.stat().st_size, 'sha256': digest(source), 'container_duration_s': float(before['format']['duration'])},
        'transformation': {'video': 'stream copy; all frames retained; no crop, resize, retiming or re-encoding', 'audio': 'removed', 'fast_start': True, 'poster_time_s': poster_time},
        'video': {'width': stream['width'], 'height': stream['height'], 'frame_rate': stream['avg_frame_rate'], 'pixel_format': stream['pix_fmt'], 'duration_s': float(after['streams'][0]['duration']), 'frames': len(output_frames), 'decoded_frames_identical': True, 'audio_streams': 0},
        'rights': {'authorship': 'Third-party Tesla footage supplied by the user, not original game artwork.', 'redistribution_license': 'Not asserted or inferred from user possession; public release approval is separate.', 'endorsement': 'No affiliation or endorsement is claimed.'},
        'files': records,
    }
    target = ROOT / 'art/garage/screen/supplied-video-provenance.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, indent=2) + '\n')
    print(json.dumps(data, indent=2))


def main():
    """Accept an explicit user file and a poster timestamp; never fetch a remote video automatically."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--poster-time', required=True, type=float)
    args = parser.parse_args()
    prepare(args.input, args.poster_time)


if __name__ == '__main__':
    main()
