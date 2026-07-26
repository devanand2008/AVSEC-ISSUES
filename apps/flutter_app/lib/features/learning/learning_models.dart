class LearningCourse {
  const LearningCourse({
    required this.id,
    required this.code,
    required this.title,
    required this.status,
    this.description,
    this.moduleCount = 0,
    this.resourceCount = 0,
    this.assessmentCount = 0,
  });

  final String id;
  final String code;
  final String title;
  final String status;
  final String? description;
  final int moduleCount;
  final int resourceCount;
  final int assessmentCount;

  factory LearningCourse.fromJson(Map<String, dynamic> json) {
    final count = json['_count'] as Map<String, dynamic>?;
    return LearningCourse(
      id: json['id'] as String,
      code: json['code'] as String? ?? '',
      title: json['title'] as String? ?? 'Untitled course',
      status: json['status'] as String? ?? 'PUBLISHED',
      description: json['description'] as String?,
      moduleCount: count?['modules'] as int? ?? json['moduleCount'] as int? ?? 0,
      resourceCount: count?['resources'] as int? ?? json['resourceCount'] as int? ?? 0,
      assessmentCount: count?['assessments'] as int? ?? json['assessmentCount'] as int? ?? 0,
    );
  }
}

class LearningSubject {
  const LearningSubject({
    required this.id,
    required this.code,
    required this.name,
    required this.courses,
  });

  final String id;
  final String code;
  final String name;
  final List<LearningCourse> courses;

  factory LearningSubject.fromJson(Map<String, dynamic> json) {
    final rawCourses = json['availableCourses'];
    return LearningSubject(
      id: json['id'] as String,
      code: json['code'] as String? ?? '',
      name: json['name'] as String? ?? 'Subject',
      courses: rawCourses is List
          ? rawCourses.whereType<Map<String, dynamic>>().map(LearningCourse.fromJson).toList()
          : const [],
    );
  }
}

class LearningProgress {
  const LearningProgress({
    required this.completedLessons,
    required this.totalLessons,
    required this.items,
    this.percent,
  });

  final int completedLessons;
  final int totalLessons;
  final int? percent;
  final List<dynamic> items;

  factory LearningProgress.fromJson(Map<String, dynamic> json) {
    return LearningProgress(
      completedLessons: json['completedLessons'] as int? ?? 0,
      totalLessons: json['totalLessons'] as int? ?? 0,
      percent: json['percent'] as int?,
      items: json['items'] as List<dynamic>? ?? const [],
    );
  }
}
