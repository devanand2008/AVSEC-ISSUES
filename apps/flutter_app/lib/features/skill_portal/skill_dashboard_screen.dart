import 'package:flutter/material.dart';

import '../learning/learning_models.dart';
import 'skill_repository.dart';

class SkillDashboardScreen extends StatefulWidget {
  const SkillDashboardScreen({super.key, SkillRepository? repository})
      : _repository = repository;

  final SkillRepository? _repository;

  @override
  State<SkillDashboardScreen> createState() => _SkillDashboardScreenState();
}

class _SkillDashboardScreenState extends State<SkillDashboardScreen> {
  late final SkillRepository _repository;
  late Future<(List<LearningCourse>, LearningProgress)> _future;

  @override
  void initState() {
    super.initState();
    _repository = widget._repository ?? SkillRepository();
    _future = _load();
  }

  Future<(List<LearningCourse>, LearningProgress)> _load() async {
    final values =
        await Future.wait([_repository.courses(), _repository.progress()]);
    return (
      values[0] as List<LearningCourse>,
      values[1] as LearningProgress,
    );
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async {
        setState(() => _future = _load());
        await _future;
      },
      child: FutureBuilder<(List<LearningCourse>, LearningProgress)>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return ListView(
              padding: const EdgeInsets.all(24),
              children: [Text('${snapshot.error}')],
            );
          }
          final (courses, progress) = snapshot.requireData;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(
                'AVS Skill Portal',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 12),
              LinearProgressIndicator(
                value: progress.percent == null ? 0 : progress.percent! / 100,
              ),
              const SizedBox(height: 6),
              Text('${progress.completedLessons} lessons completed'),
              const SizedBox(height: 18),
              ...courses.map(
                (course) => ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 4),
                  leading: const Icon(Icons.code),
                  title: Text(course.title),
                  subtitle: Text(
                    '${course.code} · ${course.moduleCount} modules',
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => SkillCourseDetailsScreen(
                        courseId: course.id,
                        repository: _repository,
                      ),
                    ),
                  ),
                ),
              ),
              if (courses.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 32),
                  child: Center(child: Text('No assigned courses')),
                ),
            ],
          );
        },
      ),
    );
  }
}

class SkillCourseDetailsScreen extends StatelessWidget {
  const SkillCourseDetailsScreen({
    super.key,
    required this.courseId,
    required this.repository,
  });

  final String courseId;
  final SkillRepository repository;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Course')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: repository.course(courseId),
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            if (snapshot.hasError) return Center(child: Text('${snapshot.error}'));
            return const Center(child: CircularProgressIndicator());
          }
          final course = snapshot.requireData;
          final modules = course['modules'] as List<dynamic>? ?? const [];
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(
                course['title'] as String? ?? 'Course',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              if (course['description'] is String) ...[
                const SizedBox(height: 8),
                Text(course['description'] as String),
              ],
              const SizedBox(height: 20),
              ...modules.whereType<Map<String, dynamic>>().map(
                    (module) => ExpansionTile(
                      title: Text(module['title'] as String? ?? 'Module'),
                      children: (module['lessons'] as List<dynamic>? ?? const [])
                          .whereType<Map<String, dynamic>>()
                          .map(
                            (lesson) => ListTile(
                              leading: const Icon(Icons.play_lesson_outlined),
                              title: Text(
                                lesson['title'] as String? ?? 'Lesson',
                              ),
                            ),
                          )
                          .toList(),
                    ),
                  ),
            ],
          );
        },
      ),
    );
  }
}
