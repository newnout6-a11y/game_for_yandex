"""Real GLB NORMAL-accessor mutation tests; stdlib Python, no Blender required."""
import json
import math
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'art/garage'))
from normal_validation import (assert_normal_preserved, validate_exported_normals,
    NORMAL_COMPONENT_TOLERANCE, NORMAL_ANGLE_TOLERANCE_DEGREES)


def normal_accessor(payload, mesh_index=0):
    json_size = struct.unpack_from('<I', payload, 12)[0]
    doc = json.loads(payload[20:20 + json_size])
    primitive = doc['meshes'][mesh_index]['primitives'][0]
    accessor = doc['accessors'][primitive['attributes']['NORMAL']]
    assert accessor['componentType'] == 5126 and accessor['type'] == 'VEC3'
    view = doc['bufferViews'][accessor['bufferView']]
    offset = 28 + json_size + view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    stride = view.get('byteStride', 12)
    return [struct.unpack_from('<3f', payload, offset + i * stride)
            for i in range(accessor['count'])], offset, doc


def normalized(normal):
    length = math.hypot(*normal)
    return tuple(v / length for v in normal)


def rotated(normal, degrees):
    normal = normalized(normal)
    axis = min(range(3), key=lambda i: abs(normal[i]))
    tangent = [float(i == axis) - normal[i] * normal[axis] for i in range(3)]
    tangent = normalized(tangent)
    angle = math.radians(degrees)
    return tuple(v * math.cos(angle) + t * math.sin(angle) for v, t in zip(normal, tangent))


class ExportedNormalAuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = (ROOT / 'public/assets/garage/tier4.glb').read_bytes()
        cls.normals, cls.offset, cls.doc = normal_accessor(cls.payload)

    def mutate(self, normal):
        fixture = bytearray(self.payload)
        struct.pack_into('<3f', fixture, self.offset, *normal)
        # This negative fixture changes an actual exported shading accessor,
        # not a report field. JSON, indices, positions, UVs and images stay exact.
        self.assertEqual(fixture[:self.offset], self.payload[:self.offset])
        self.assertEqual(fixture[self.offset + 12:], self.payload[self.offset + 12:])
        self.assertNotEqual(fixture, self.payload)
        normals, offset, doc = normal_accessor(fixture)
        self.assertEqual(offset, self.offset)
        self.assertEqual(doc, self.doc)
        return normals

    def enforce(self, current, transformed):
        # These are the same raw-data guard and corner-match guard invoked by
        # audit_stable_orbit.py before it can aggregate or emit passing proof.
        validate_exported_normals(current, 'negative fixture current')
        validate_exported_normals(self.normals, 'negative fixture baseline')
        return assert_normal_preserved(normalized(current[0]), [normalized(self.normals[0])],
            [transformed], current[0], [self.normals[0]], 'real exported NORMAL fixture')

    def test_all_real_exported_normals_are_finite_unit_vectors(self):
        for tier in (1, 2, 3, 4):
            payload = (ROOT / f'public/assets/garage/tier{tier}.glb').read_bytes()
            _, _, doc = normal_accessor(payload)
            for mesh in range(len(doc['meshes'])):
                normals, _, _ = normal_accessor(payload, mesh)
                validate_exported_normals(normals, (tier, mesh))

    def test_unchanged_accessor_is_exact(self):
        self.assertEqual(self.enforce(self.normals, False), (0, 0, 0))

    def test_rotated_real_shading_normal_fails_even_for_moved_geometry(self):
        current = self.mutate(rotated(self.normals[0], 1))
        with self.assertRaisesRegex(AssertionError, 'shading NORMAL changed'):
            self.enforce(current, True)

    def test_tiny_real_shading_change_cannot_borrow_moved_allowance(self):
        current = self.mutate(rotated(self.normals[0], .001))
        self.enforce(current, True)
        with self.assertRaisesRegex(AssertionError, 'shading NORMAL changed'):
            self.enforce(current, False)
        with self.assertRaisesRegex(AssertionError, 'shading NORMAL changed'):
            assert_normal_preserved(normalized(current[0]), [normalized(self.normals[0])],
                [True], current[0], [self.normals[0]], 'unrelated coincident source face',
                allow_transformed=False)

    def test_normalization_cannot_hide_scaled_normal(self):
        current = self.mutate([v * 1.01 for v in self.normals[0]])
        with self.assertRaisesRegex(AssertionError, 'Non-unit exported NORMAL'):
            self.enforce(current, True)

    def test_zero_normal_is_rejected_before_normalization(self):
        with self.assertRaisesRegex(AssertionError, 'Non-unit exported NORMAL'):
            self.enforce(self.mutate([0, 0, 0]), True)

    def test_nan_and_infinity_cannot_disappear_in_maximum(self):
        for value in (float('nan'), float('inf')):
            with self.subTest(value=value), self.assertRaisesRegex(AssertionError, 'Non-finite'):
                self.enforce(self.mutate([value, *self.normals[0][1:]]), True)

    def test_angular_limit_is_independent_of_component_limit(self):
        angle = math.radians(.11)
        current = (math.sin(angle) / math.sqrt(2), math.sin(angle) / math.sqrt(2), math.cos(angle))
        baseline = (0, 0, 1)
        self.assertLess(max(abs(a-b) for a, b in zip(current, baseline)), NORMAL_COMPONENT_TOLERANCE)
        self.assertGreater(math.degrees(angle), NORMAL_ANGLE_TOLERANCE_DEGREES)
        with self.assertRaisesRegex(AssertionError, 'shading NORMAL changed'):
            assert_normal_preserved(current, [baseline], [True], current, [baseline], 'angular-only defect')

    def test_one_candidate_must_satisfy_both_constraints(self):
        current = (0, 0, 1)
        exact_but_unrelated = current
        changed = rotated(current, .05)
        # A correct matching baseline corner remains valid after reindexing.
        self.assertEqual(assert_normal_preserved(current, [changed, exact_but_unrelated],
            [True, False], current, [changed, exact_but_unrelated], 'reindexed'), (1, 0, 0))


if __name__ == '__main__':
    unittest.main()
