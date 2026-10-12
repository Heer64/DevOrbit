import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, Camera, Check, Code2, Edit3, ExternalLink, Github, Globe2, Linkedin, MapPin, Plus, Save, Sparkles, Trash2, Users, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { profileApi, projectApi, toProfileProject } from '../api';
import { Avatar, Btn, Heading, tone } from '../components/ui';

const initialProjects = [
  { name: 'Orbit dashboard', role: 'Frontend & product', tech: ['React', 'CSS'], color: 'violet', status: 'In progress', progress: 72 },
  { name: 'Pulse API', role: 'Backend developer', tech: ['Node.js', 'MongoDB'], color: 'orange', status: 'In progress', progress: 46 },
  { name: 'Greenlight', role: 'Contributor', tech: ['React', 'Express'], color: 'teal', status: 'Completed', progress: 100 },
];
const initialSkills = ['React', 'Node.js', 'MongoDB', 'Express', 'JavaScript', 'UI thinking'];
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png'];

export default function ProfilePage() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState(user?.bio || user?.headline || (user?.isDemo ? 'Full-stack developer who loves building useful things with thoughtful people.' : ''));
  const [skills, setSkills] = useState(user?.skills?.length ? user.skills : (user?.isDemo ? initialSkills : []));
  const [githubUrl, setGithubUrl] = useState(user?.githubUrl || '');
  const [linkedinUrl, setLinkedinUrl] = useState(user?.linkedinUrl || '');
  const [newSkill, setNewSkill] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [myProjects, setMyProjects] = useState(user?.isDemo ? initialProjects : []);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const photoInput = useRef(null);

  useEffect(() => {
    setBio(user?.bio || user?.headline || (user?.isDemo ? 'Full-stack developer who loves building useful things with thoughtful people.' : ''));
    setSkills(user?.skills?.length ? user.skills : (user?.isDemo ? initialSkills : []));
    setGithubUrl(user?.githubUrl || '');
    setLinkedinUrl(user?.linkedinUrl || '');
  }, [user?.id]);

  useEffect(() => {
    let active = true;
    const loadProjects = async () => {
      if (!user) return;
      if (user.isDemo) { setMyProjects(initialProjects); return; }
      try {
        const result = await projectApi.list();
        if (active) setMyProjects((result.projects || []).map((project) => toProfileProject(project, user)));
      } catch { if (active) setMyProjects([]); }
    };
    loadProjects();
    const reload = () => loadProjects();
    window.addEventListener('devorbit:projects-updated', reload);
    return () => { active = false; window.removeEventListener('devorbit:projects-updated', reload); };
  }, [user]);

  const fullName = user?.fullName || user?.name || 'Aarav Mehta';
  const initials = fullName.split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  const addSkill = () => { const value = newSkill.trim(); if (value && !skills.includes(value) && skills.length < 10) setSkills([...skills, value]); setNewSkill(''); };
  const saveProfile = async () => {
    setProfileError(''); setSaving(true);
    const payload = { bio: bio.trim(), headline: bio.trim().slice(0, 120), skills, githubUrl: githubUrl.trim(), linkedinUrl: linkedinUrl.trim() };
    try {
      if (user?.isDemo) updateUser({ ...user, ...payload });
      else { const result = await profileApi.update(payload); updateUser(result.user); }
      setSaved(true); setEditing(false);
    } catch (error) { setProfileError(error.message || 'Could not save your profile.'); }
    finally { setSaving(false); }
  };
  // Photos upload straight away (they are separate from the Save changes button).
  const choosePhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPhotoError('');
    if (!PHOTO_TYPES.includes(file.type)) { setPhotoError('Photo must be a JPEG or PNG image.'); return; }
    if (file.size > MAX_PHOTO_BYTES) { setPhotoError('Photo must be 2 MB or smaller.'); return; }
    setPhotoBusy(true);
    try {
      if (user?.isDemo) {
        const preview = URL.createObjectURL(file);
        updateUser({ ...user, avatarUrl: preview });
      } else {
        const result = await profileApi.uploadAvatar(file);
        updateUser(result.user);
      }
    } catch (error) { setPhotoError(error.message || 'Could not upload your photo.'); }
    finally { setPhotoBusy(false); }
  };
  const removePhoto = async () => {
    setPhotoError(''); setPhotoBusy(true);
    try {
      if (user?.isDemo) updateUser({ ...user, avatarUrl: '' });
      else { const result = await profileApi.removeAvatar(); updateUser(result.user); }
    } catch (error) { setPhotoError(error.message || 'Could not remove your photo.'); }
    finally { setPhotoBusy(false); }
  };
  const githubHref = toExternalUrl(githubUrl, 'https://github.com');
  const linkedinHref = toExternalUrl(linkedinUrl, 'https://linkedin.com');
  const cleanUrl = (value) => value.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return (
    <>
      <Heading eyebrow="YOUR SPACE" title="Your profile" subtitle="Show people what you build, what you know, and what you want to work on."
        action={() => { setEditing(!editing); setSaved(false); }} actionText={editing ? 'Cancel' : 'Edit profile'} actionIcon={editing ? X : Edit3} />

      <section className="profile-hero panel">
        <div className="cover"><div /><div /></div>
        <div className="profile-main">
          <Avatar initials={initials} src={user?.avatarSrc} large />
          <div className="identity">
            <h2>{fullName}</h2>
            <p>@{user?.username || fullName.toLowerCase().replace(/\s+/g, '.')} · Builder</p>
            <p className="bio">{bio || 'Add a short bio to introduce yourself to the DevOrbit community.'}</p>
            <div className="profile-links">
              <span><MapPin size={14} /> Ahmedabad, India</span>
              <span><CalendarDays size={14} /> Joined September 2026</span>
              <span><Globe2 size={14} /> devorbit.community</span>
              {githubUrl && <a href={githubHref} target="_blank" rel="noreferrer"><Github size={14} /> GitHub <ExternalLink size={11} /></a>}
              {linkedinUrl && <a href={linkedinHref} target="_blank" rel="noreferrer"><Linkedin size={14} /> LinkedIn <ExternalLink size={11} /></a>}
            </div>
          </div>
          <div className="profile-stats">
            <b>{String(myProjects.length).padStart(2, '0')}<small>Projects</small></b>
            <b>{String(skills.length).padStart(2, '0')}<small>Skills</small></b>
          </div>
        </div>
      </section>

      {editing && (
        <section className="panel edit-panel">
          <div className="panel-head"><div><div className="eyebrow">MAKE IT YOURS</div><h2>Edit your profile</h2><p>Changes are saved to your DevOrbit profile.</p></div></div>
          <div className="photo-field">
            <Avatar initials={initials} src={user?.avatarSrc} large />
            <div className="photo-actions">
              <div className="photo-buttons">
                <input ref={photoInput} type="file" accept="image/jpeg,image/png" onChange={choosePhoto} aria-label="Profile photo file" />
                <Btn secondary icon={Camera} disabled={photoBusy} onClick={() => photoInput.current?.click()}>{photoBusy ? 'Working…' : user?.avatarUrl ? 'Change photo' : 'Upload photo'}</Btn>
                {user?.avatarUrl && <Btn className="danger-text" icon={Trash2} disabled={photoBusy} onClick={removePhoto}>Remove</Btn>}
              </div>
              <small>JPEG or PNG, up to 2 MB. Photos are saved as soon as you choose them.</small>
              {photoError && <div className="form-error" role="alert">{photoError}</div>}
            </div>
          </div>
          <label className="form-label">Headline / bio
            <textarea className="field-input" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} />
            <span className="char-count">{bio.length}/500</span>
          </label>
          <label className="form-label">Add a skill tag
            <div className="add-skill">
              <input value={newSkill} maxLength={32} onChange={(e) => setNewSkill(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }} placeholder="e.g. TypeScript" />
              <Btn secondary onClick={addSkill} icon={Plus}>Add</Btn>
            </div>
          </label>
          <div className="skill-cloud">{skills.map((s) => <button type="button" key={s} className="removable" onClick={() => setSkills(skills.filter((x) => x !== s))}>{s}<X size={12} /></button>)}</div>
          <div className="edit-grid" style={{ marginTop: 16 }}>
            <label>GitHub profile URL<input value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} placeholder="https://github.com/username" maxLength={2048} /></label>
            <label>LinkedIn profile URL<input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/username" maxLength={2048} /></label>
          </div>
          {profileError && <div className="form-error" role="alert" style={{ marginTop: 14 }}>{profileError}</div>}
          <div className="edit-footer">
            <span className="muted-note">Up to 10 skills. Changes are saved to your DevOrbit profile.</span>
            <Btn onClick={saveProfile} disabled={saving} icon={Check}>{saving ? 'Saving…' : 'Save changes'}</Btn>
          </div>
        </section>
      )}
      {saved && !editing && <p className="success-inline">Profile updated successfully.</p>}

      <div className="profile-columns">
        <div className="stack-col">
          <section className="panel">
            <div className="panel-head"><div><h2>About</h2><p>A little about how I work.</p></div></div>
            <p className="about-copy">I'm a developer who enjoys turning fuzzy ideas into clear, useful products. I like collaborating across the stack, learning in public, and making tools that help teams do their best work.</p>
            <div className="social-links">
              <a className="social-card" href={githubHref} target="_blank" rel="noreferrer"><span className="social-icon"><Github size={17} /></span><span><small>GITHUB</small><strong>{githubUrl ? cleanUrl(githubUrl) : 'Add your GitHub profile'}</strong></span><ArrowUpRight size={15} /></a>
              <a className="social-card" href={linkedinHref} target="_blank" rel="noreferrer"><span className="social-icon"><Linkedin size={17} /></span><span><small>LINKEDIN</small><strong>{linkedinUrl ? cleanUrl(linkedinUrl) : 'Add your LinkedIn profile'}</strong></span><ArrowUpRight size={15} /></a>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><div><h2>Skills &amp; tools</h2><p>Tools I use to turn ideas into reality.</p></div><button className="iconbtn" onClick={() => setEditing(true)} title="Edit skills" aria-label="Edit skills"><Edit3 size={15} /></button></div>
            <div className="skill-cloud">{skills.length ? skills.map((s) => <span key={s}>{s}</span>) : <small className="muted">No skills added yet.</small>}</div>
            <button className="create-side" style={{ width: '100%', marginLeft: 0, marginRight: 0 }} onClick={() => setEditing(true)}><Plus size={14} /> Add a skill</button>
          </section>

          <section className="panel">
            <div className="panel-head"><div><div className="eyebrow">MY ORBIT</div><h2 style={{ marginTop: 6 }}>Contribution snapshot</h2></div></div>
            <div className="contrib-stat"><span className="event-icon purple"><Code2 size={17} /></span><div><b>18</b><small>Commits contributed</small></div><span className="contrib-change">+6 this week</span></div>
            <div className="contrib-stat"><span className="event-icon green"><Check size={17} /></span><div><b>24</b><small>Tasks completed</small></div></div>
            <div className="contrib-stat"><span className="event-icon blue"><Users size={17} /></span><div><b>12</b><small>Collaborators</small></div></div>
            <div className="momentum"><div><b>86%</b><small>weekly momentum</small></div><div className="momentum-ring"><span>↗</span></div></div>
          </section>
        </div>

        <div className="stack-col">
          <section className="panel">
            <div className="panel-head"><div><h2>Projects I'm building <span className="pill" style={{ marginLeft: 6 }}>{myProjects.length}</span></h2><p>Your projects, loaded from your workspace.</p></div><button className="link" onClick={() => navigate('/discover')}>Explore more <ArrowUpRight size={14} /></button></div>
            {myProjects.map((p) => (
              <button className="profile-project" key={p.id || p.name} onClick={() => p.id && navigate(`/project/${p.id}`)} style={{ cursor: p.id ? 'pointer' : 'default' }}>
                <span className={`project-avatar ${tone(p.color)}`}>{p.name[0]}</span>
                <span>
                  <b>{p.name} <span className={`pill ${p.progress === 100 ? 'green' : 'purple'}`} style={{ marginLeft: 4 }}>{p.status}</span></b>
                  <small>{p.role}</small>
                  <span className="tags">{(p.tech || []).map((t) => <i key={t}>{t}</i>)}</span>
                </span>
                <span className="progress-mini"><b>{p.progress}%</b><span className="progress"><i style={{ width: `${p.progress}%` }} /></span></span>
              </button>
            ))}
            {myProjects.length === 0 && <p className="empty-inline">No projects yet. Create or join a project to build your portfolio.</p>}
          </section>

          <section className="note-card">
            <div className="eyebrow"><Sparkles size={13} /> KEEP GROWING</div>
            <h3>Your work tells a story.</h3>
            <p>Every project is another chapter. Keep building and let your contributions speak for themselves.</p>
            <button className="link" onClick={() => navigate('/discover')}>Discover projects <ArrowUpRight size={14} /></button>
          </section>
        </div>
      </div>
    </>
  );
}

function toExternalUrl(value, fallback) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return fallback;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
