import { Avatar } from './ui';
import VideoRoom from './VideoRoom';

export default function RoomSidebar({ collapsed, mobileOpen, socket, userName, participants, users }) {
  return (
    <aside id="room-sidebar" className={`cc-sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <VideoRoom socket={socket} userName={userName} participants={participants} />
      <h2>People ({users.length})</h2>
      <div className="cc-people">
        {users.length ? users.map((name, index) => (
          <div className="cc-person" key={`${name}-${index}`}>
            <Avatar name={name} />
            <span>{name} {name === userName && <small className="cc-you">(you)</small>}</span>
          </div>
        )) : <p className="cc-empty">No one else is here yet.</p>}
      </div>
    </aside>
  );
}
