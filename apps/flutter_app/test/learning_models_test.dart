import 'package:avs_college_flutter/features/learning/learning_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('LearningCourse reads count aliases from AVS API payloads', () {
    final course = LearningCourse.fromJson({
      'id': 'course-1',
      'code': 'CS101',
      'title': 'Programming',
      'status': 'PUBLISHED',
      '_count': {'modules': 2, 'resources': 4, 'assessments': 1},
    });

    expect(course.moduleCount, 2);
    expect(course.resourceCount, 4);
    expect(course.assessmentCount, 1);
  });
}
