import 'package:flutter/material.dart';

import 'learning_course_screen.dart';
import 'learning_models.dart';
import 'learning_repository.dart';

class LearningHomeScreen extends StatefulWidget {
  const LearningHomeScreen({super.key, LearningRepository? repository}) : _repository = repository;

  final LearningRepository? _repository;

  @override
  State<LearningHomeScreen> createState() => _LearningHomeScreenState();
}

class _LearningHomeScreenState extends State<LearningHomeScreen> {
  late final LearningRepository _repository;
  late Future<_LearningHomeData> _future;

  @override
  void initState() {
    super.initState();
    _repository = widget._repository ?? LearningRepository();
    _future = _load();
  }

  Future<_LearningHomeData> _load() async {
    final results = await Future.wait([
      _repository.health(),
      _repository.subjects(),
      _repository.courses(),
      _repository.progress(),
    ]);
    return _LearningHomeData(
      health: results[0] as Map<String, dynamic>,
      subjects: results[1] as List<LearningSubject>,
      courses: results[2] as List<LearningCourse>,
      progress: results[3] as LearningProgress,
    );
  }

  Future<void> _refresh() async {
    setState(() => _future = _load());
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('AVS Learn')),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<_LearningHomeData>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return ListView(
                padding: const EdgeInsets.all(24),
                children: [
                  Text('Unable to load AVS Learn', style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 8),
                  Text('${snapshot.error}'),
                ],
              );
            }
            final data = snapshot.requireData;
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _HealthTile(health: data.health),
                const SizedBox(height: 16),
                _ProgressTile(progress: data.progress),
                const SizedBox(height: 16),
                Text('My Subjects', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 8),
                ...data.subjects.map((subject) => _SubjectTile(subject: subject)),
                const SizedBox(height: 16),
                Text('Courses', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 8),
                ...data.courses.map((course) => _CourseTile(course: course, repository: _repository)),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _HealthTile extends StatelessWidget {
  const _HealthTile({required this.health});

  final Map<String, dynamic> health;

  @override
  Widget build(BuildContext context) {
    final ok = health['ok'] == true;
    return ListTile(
      tileColor: Theme.of(context).colorScheme.surfaceContainerHighest,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      leading: Icon(ok ? Icons.check_circle : Icons.error_outline, color: ok ? Colors.green : Colors.orange),
      title: Text(ok ? 'Learn portal connected' : 'Learn portal needs attention'),
      subtitle: Text('${health['coursesAvailable'] ?? 0} published courses available'),
    );
  }
}

class _ProgressTile extends StatelessWidget {
  const _ProgressTile({required this.progress});

  final LearningProgress progress;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      tileColor: Theme.of(context).colorScheme.surfaceContainerHighest,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      leading: const Icon(Icons.timeline),
      title: Text('${progress.completedLessons} lessons completed'),
      subtitle: progress.percent == null ? const Text('Open a course to see course progress') : Text('${progress.percent}% complete'),
    );
  }
}

class _SubjectTile extends StatelessWidget {
  const _SubjectTile({required this.subject});

  final LearningSubject subject;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: const Icon(Icons.menu_book_outlined),
      title: Text(subject.name),
      subtitle: Text('${subject.code} - ${subject.courses.length} linked courses'),
    );
  }
}

class _CourseTile extends StatelessWidget {
  const _CourseTile({required this.course, required this.repository});

  final LearningCourse course;
  final LearningRepository repository;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: const Icon(Icons.school_outlined),
      title: Text(course.title),
      subtitle: Text('${course.code} - ${course.moduleCount} modules - ${course.resourceCount} resources'),
      trailing: const Icon(Icons.chevron_right),
      onTap: () {
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => LearningCourseScreen(courseId: course.id, repository: repository),
          ),
        );
      },
    );
  }
}

class _LearningHomeData {
  const _LearningHomeData({
    required this.health,
    required this.subjects,
    required this.courses,
    required this.progress,
  });

  final Map<String, dynamic> health;
  final List<LearningSubject> subjects;
  final List<LearningCourse> courses;
  final LearningProgress progress;
}
