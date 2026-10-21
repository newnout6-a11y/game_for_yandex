"""Validate/zero unused ImagePackedFile path bytes in an uncompressed .blend.

Blender's RNA string setter can retain an old absolute filename after the first
NUL in its fixed char array. Parse SDNA to locate only those metadata fields;
never scan/replace geometry or compressed image payloads. Default CLI is read-only.
"""
import json
import os
import tempfile
from pathlib import Path
import struct


def require_supported_blender(version, byteorder, pointer_bytes):
    """Reject unsupported file layouts before the authoring entrypoint mutates anything."""
    if tuple(version[:2]) != (4, 3) or byteorder != 'little' or pointer_bytes != 8:
        raise RuntimeError('Roadster rebuild requires Blender 4.3.x, 64-bit little-endian; existing source was not changed')


def save_portable_blend(path, save):
    """Validate a temporary uncompressed save before atomically replacing the source.

    The callback must save a copy without changing Blender's active filepath, so
    relative textures keep resolving against the intended source directory.
    """
    path = Path(path)
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.stem + '-', suffix='.blend', dir=path.parent)
    os.close(descriptor)
    temporary = Path(temporary)
    try:
        save(str(temporary))
        result = normalize_packed_image_padding(temporary)
        os.replace(temporary, path)
        return result
    finally:
        temporary.unlink(missing_ok=True)


def _path_fields(data, image_records=False):
    if data[:12] != b'BLENDER-v403':
        raise ValueError('Expected the pinned uncompressed 64-bit little-endian Blender 4.3 file')
    blocks = []
    offset = 12
    while offset + 24 <= len(data):
        code, size, _address, sdna, count = struct.unpack_from('<4sIQII', data, offset)
        start = offset + 24
        if start + size > len(data):
            raise ValueError('Invalid Blender block length')
        blocks.append((code, start, size, sdna, count))
        offset = start + size
        if code == b'ENDB':
            break
    dna = next(data[start:start+size] for code, start, size, _index, _count in blocks if code == b'DNA1')
    assert dna[:8] == b'SDNANAME'
    offset = 8

    def strings():
        nonlocal offset
        count = struct.unpack_from('<I', dna, offset)[0]
        offset += 4
        result = []
        for _ in range(count):
            end = dna.index(0, offset)
            result.append(bytes(dna[offset:end]).decode())
            offset = end + 1
        offset = (offset + 3) & ~3
        return result

    names = strings()
    assert dna[offset:offset+4] == b'TYPE'
    offset += 4
    types = strings()
    assert dna[offset:offset+4] == b'TLEN'
    offset += 4
    sizes = struct.unpack_from('<' + 'H' * len(types), dna, offset)
    offset = (offset + len(types) * 2 + 3) & ~3
    assert dna[offset:offset+4] == b'STRC'
    offset += 4
    count = struct.unpack_from('<I', dna, offset)[0]
    offset += 4
    packed_index = packed_size = None
    image_index = image_size = None
    for index in range(count):
        type_index, fields = struct.unpack_from('<HH', dna, offset)
        offset += 4
        declaration = []
        for _ in range(fields):
            field_type, field_name = struct.unpack_from('<HH', dna, offset)
            offset += 4
            declaration.append((types[field_type], names[field_name]))
        if types[type_index] == 'Image':
            assert declaration[:4] == [('ID', 'id'), ('AnimData', '*adt'), ('DrawDataList', 'drawdata'), ('char', 'name[1024]')]
            assert sizes[types.index('ID')] == 208 and sizes[types.index('DrawDataList')] == 16
            image_index, image_size = index, sizes[type_index]
            assert image_size == 1600
        if types[type_index] == 'ImagePackedFile':
            assert declaration == [('ImagePackedFile', '*next'), ('ImagePackedFile', '*prev'),
                ('PackedFile', '*packedfile'), ('int', 'view'), ('int', 'tile_number'), ('char', 'filepath[1024]')]
            packed_index, packed_size = index, sizes[type_index]
            assert packed_size == 32 + 1024
    assert packed_index is not None and image_index is not None
    selected_index, selected_size, path_offset = (image_index, image_size, 232) if image_records else (packed_index, packed_size, 32)
    for _code, start, size, index, count in blocks:
        if index != selected_index:
            continue
        assert size == selected_size * count
        for item in range(count):
            field_start = start + item * selected_size + path_offset
            field = data[field_start:field_start+1024]
            end = field.index(0)
            path = bytes(field[:end]).decode()
            # Cleared Image.filepath is valid, but its unused bytes must still
            # be inspected and zeroed; skipping it can retain an older name.
            assert (image_records and not path) or (path.startswith('//textures/') and '..' not in path.split('/')), path
            yield field_start, end, path


def packed_path_fields(data):
    """ImagePackedFile.filepath metadata fields (kept for existing audit callers)."""
    yield from _path_fields(data)


def image_path_fields(data):
    """Image.name is the SDNA storage backing the Image.filepath RNA property."""
    yield from _path_fields(data, image_records=True)


def all_path_fields(data):
    yield from packed_path_fields(data)
    yield from image_path_fields(data)


def normalize_packed_image_padding(path):
    path = Path(path)
    data = bytearray(path.read_bytes())
    fields = list(all_path_fields(data))
    assert fields, 'No packed image paths found'
    for start, end, _name in fields:
        data[start+end:start+1024] = bytes(1024-end)
    path.write_bytes(data)
    return validate_packed_image_padding(path)


def validate_packed_image_padding(path):
    data = Path(path).read_bytes()
    fields = list(all_path_fields(data))
    assert fields, 'No packed image paths found'
    for start, end, name in fields:
        assert not any(data[start+end:start+1024]), 'Stale packed path padding: ' + name
    for token in (b'/workspace/', b'/home/', b'/tmp/', b'/Users/', b'C:\\Users\\'):
        assert token not in data, 'Private absolute path remains in saved source'
    return {'packedPaths': [name for _start, _end, name in packed_path_fields(data)],
            'imagePaths': [name for _start, _end, name in image_path_fields(data)], 'nonzeroPaddingBytes': 0}


if __name__ == '__main__':
    import sys
    assert len(sys.argv) == 2, 'Usage: python portable_blender_images.py file.blend (read-only)'
    print(json.dumps(validate_packed_image_padding(sys.argv[1]), indent=2))
